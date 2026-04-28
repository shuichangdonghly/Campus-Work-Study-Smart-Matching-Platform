const { call } = require('../../utils/cloud.js');

function getStudentVerifyPayload(student) {
  if (!student) return {};
  if (student.studentVerifyPayload) return student.studentVerifyPayload;
  if (student.verifyPayload) return student.verifyPayload;
  return {};
}

function getStudentDisplayName(student) {
  const p = getStudentVerifyPayload(student);
  return p.realName || (student && student.nickName) || '学生';
}

function buildStudentDetails(student) {
  const p = getStudentVerifyPayload(student);
  return [
    { label: '姓名', value: p.realName || '未填写' },
    { label: '学号', value: p.studentNo || '未填写' },
    { label: '专业', value: p.major || '未填写' },
    { label: '年级', value: p.grade || '未填写' }
  ];
}

function buildOrderStudentSummary(order) {
  const student = order && order.student;
  if (!student) return '学生';
  const p = getStudentVerifyPayload(student);
  const name = p.realName || student.nickName || '学生';
  const studentNo = p.studentNo ? `（${p.studentNo}）` : '';
  return `${name}${studentNo}`;
}

function formatText(value) {
  if (value == null) return '';
  return String(value).trim();
}

function formatTime(value) {
  if (!value) return '未提交';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  const hh = `${d.getHours()}`.padStart(2, '0');
  const mm = `${d.getMinutes()}`.padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function normalizeApplication(app) {
  const student = app.student || {};
  return {
    ...app,
    studentDisplayName: getStudentDisplayName(student),
    studentDetails: buildStudentDetails(student)
  };
}

function normalizeOrder(order) {
  return {
    ...order,
    studentDisplayName: buildOrderStudentSummary(order),
    submitTextDisplay: formatText(order.submitText),
    submitTimeDisplay: formatTime(order.submitTime)
  };
}

function normalizeStatus(status) {
  const map = {
    applied: '已报名',
    accepted: '已录用',
    rejected: '未录用',
    ongoing: '进行中',
    pending_settlement: '待交易',
    submitted: '待交易',
    completed: '已结束',
    closed: '已关闭',
    publisher_cancelled: '发布者已下架',
    admin_cancelled: '管理员取消订单'
  };
  return map[status] || status || '未知状态';
}

function normalizeApplicationStatus(status) {
  const map = {
    applied: '待处理',
    accepted: '已录用',
    rejected: '未录用'
  };
  return map[status] || status || '未知状态';
}

function normalizeJobStatus(status) {
  const map = {
    pending_review: '待审核',
    open: '招募中',
    approved: '招募中',
    ongoing: '进行中',
    closed: '已结束',
    rejected: '已驳回',
    publisher_cancelled: '发布者已下架',
    admin_cancelled: '管理员取消订单'
  };
  return map[status] || status || '未知状态';
}

function normalizeApplications(apps) {
  return (apps || []).map((a) => ({
    ...normalizeApplication(a),
    statusText: normalizeApplicationStatus(a.status)
  }));
}

function normalizeOrders(orders) {
  return (orders || []).map((o) => ({
    ...normalizeOrder(o),
    statusText: normalizeStatus(o.status)
  }));
}

async function resolveCloudFileUrls(fileIds) {
  const ids = Array.from(new Set((fileIds || []).filter(Boolean)));
  if (!ids.length) return {};
  try {
    const res = await wx.cloud.getTempFileURL({ fileList: ids });
    const list = (res && res.fileList) || [];
    const map = {};
    for (const item of list) {
      const key = item.fileID;
      if (!key) continue;
      map[key] = item.tempFileURL || '';
    }
    return map;
  } catch (e) {
    return {};
  }
}

Page({
  data: {
    jobId: '',
    job: null,
    apps: [],
    orders: [],
    canCancelJob: false,
    canContinueRecruiting: false,
    remainingSlots: 0,
    cancelCompensationCount: 0,
    cancelCompensationTotal: 0
  },

  onLoad(options) {
    const id = options.id || '';
    this.setData({ jobId: id });
    if (id) this.reload(id);
  },

  onShow() {
    if (this.data.jobId) this.reload(this.data.jobId);
  },

  async reload(jobId) {
    try {
      const [gj, ga, go] = await Promise.all([
        call('job', { action: 'getJob', jobId }),
        call('job', { action: 'listApplications', jobId }),
        call('job', { action: 'publisherWorkOrders' })
      ]);
      const rawOrders = normalizeOrders((go.list || []).filter((o) => o.jobId === jobId));
      const photoUrlMap = await resolveCloudFileUrls(rawOrders.map((o) => o.submitPhotoFileId));
      const orders = rawOrders.map((o) => ({
        ...o,
        submitPhotoUrl: o.submitPhotoUrl || photoUrlMap[o.submitPhotoFileId] || o.submitPhotoFileId || ''
      }));
      const apps = normalizeApplications(ga.list || []);
      const activeOrders = orders.filter((o) => ['ongoing', 'pending_settlement', 'submitted'].includes(o.status));
      const cancelCompensationTotal = activeOrders.reduce(
        (sum, o) => sum + Math.ceil((parseInt(o.rewardPoints, 10) || 0) * 0.05),
        0
      );
      const canCancelJob = !!gj.job && ['open', 'approved', 'ongoing'].includes(gj.job.status);
      const needCount = parseInt((gj.job && gj.job.needCount) || 0, 10) || 0;
      const filledCount = parseInt((gj.job && gj.job.filledCount) || 0, 10) || 0;
      const remainingSlots = Math.max(0, needCount - filledCount - activeOrders.length);
      const canContinueRecruiting = !!gj.job && gj.job.status === 'ongoing' && remainingSlots > 0;
      this.setData({
        job: gj.job ? { ...gj.job, statusText: normalizeJobStatus(gj.job.status) } : null,
        apps,
        orders,
        canCancelJob,
        canContinueRecruiting,
        remainingSlots,
        cancelCompensationCount: activeOrders.length,
        cancelCompensationTotal
      });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
    }
  },

  async cancelJob() {
    if (!this.data.jobId || !this.data.canCancelJob) return;
    const { cancelCompensationCount, cancelCompensationTotal } = this.data;
    const content = cancelCompensationCount > 0
      ? `已录用 ${cancelCompensationCount} 人，取消将向每人补偿5%工分（共 ${cancelCompensationTotal} 工分），并退还剩余押金。确认下架？`
      : '当前尚未录用兼职者，可直接下架并退还剩余押金。确认下架？';
    const modalRes = await new Promise((resolve) => {
      wx.showModal({
        title: '确认下架兼职',
        content,
        confirmText: '确认下架',
        cancelText: '再想想',
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!modalRes.confirm) return;
    wx.showLoading({ title: '处理中' });
    try {
      const r = await call('job', {
        action: 'publisherCancelJob',
        jobId: this.data.jobId
      });
      wx.showToast({ title: (r && r.message) || '已下架', icon: 'none' });
      this.reload(this.data.jobId);
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '下架失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async accept(e) {
    const applicationId = e.currentTarget.dataset.id;
    wx.showLoading({ title: '处理中' });
    try {
      await call('job', { action: 'acceptApplication', applicationId });
      wx.showToast({ title: '已录用', icon: 'success' });
      this.reload(this.data.jobId);
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async confirm(e) {
    const orderId = e.currentTarget.dataset.id;
    wx.showLoading({ title: '确认中' });
    try {
      const r = await call('job', { action: 'confirmWork', orderId });
      wx.showToast({ title: (r && r.message) || '已发放工分', icon: 'success' });
      this.reload(this.data.jobId);
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async generateSignCode(e) {
    const orderId = String(e.currentTarget.dataset.id || '').trim();
    if (!orderId) {
      wx.showToast({ title: '订单信息缺失，请刷新重试', icon: 'none' });
      return;
    }
    let loadingShown = true;
    wx.showLoading({ title: '生成中' });
    try {
      const r = await call('generateSignCode', { orderId });
      wx.hideLoading();
      loadingShown = false;
      wx.showModal({
        title: '签到码（1小时有效）',
        content: `${r.signCode}`,
        showCancel: false
      });
      this.reload(this.data.jobId);
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '生成失败', icon: 'none' });
    } finally {
      if (loadingShown) wx.hideLoading();
    }
  },

  openComplaintMenu(e) {
    const orderId = e.currentTarget.dataset.id;
    const order = (this.data.orders || []).find((o) => o._id === orderId);
    const canNoShow = order && !order.signTime;
    const itemList = canNoShow
      ? ['对方爽约未到岗（提交审核）', '其他问题投诉 / 申诉']
      : ['其他问题投诉 / 申诉'];
    wx.showActionSheet({
      itemList,
      success: (res) => {
        if (canNoShow && res.tapIndex === 0) {
          this.runReportNoShow(orderId);
        } else {
          this.runReportOther(orderId);
        }
      }
    });
  },

  async runReportNoShow(orderId) {
    const reason = await this.inputText('爽约投诉说明', '例如：约定时间未到岗', true);
    if (reason === null) return;
    wx.showLoading({ title: '提交中' });
    try {
      await call('job', { action: 'reportNoShow', orderId, reason });
      await this.showAppealUploadedModal();
      this.reload(this.data.jobId);
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '提交失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async runReportOther(orderId) {
    const reason = await this.inputText('投诉 / 申诉说明', '请填写事由（至少4个字）', true);
    if (reason === null) return;
    if (String(reason).trim().length < 4) {
      wx.showToast({ title: '说明至少4个字', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '提交中' });
    try {
      await call('job', {
        action: 'reportOtherDispute',
        orderId,
        reason: String(reason).trim()
      });
      await this.showAppealUploadedModal();
      this.reload(this.data.jobId);
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '提交失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  inputText(title, placeholder, required = false) {
    return new Promise((resolve) => {
      wx.showModal({
        title,
        editable: true,
        placeholderText: placeholder,
        success: (res) => {
          if (!res.confirm) return resolve(null);
          const value = (res.content || '').trim();
          if (required && !value) {
            wx.showToast({ title: '请输入内容', icon: 'none' });
            return resolve(null);
          }
          resolve(value);
        },
        fail: () => resolve(null)
      });
    });
  },

  showAppealUploadedModal() {
    return new Promise((resolve) => {
      wx.showModal({
        title: '提示',
        content: '申诉订单已上传',
        showCancel: false,
        confirmText: '确定',
        success: () => resolve(),
        fail: () => resolve()
      });
    });
  }
});
