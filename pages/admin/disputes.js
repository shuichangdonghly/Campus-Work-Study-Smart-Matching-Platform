const { call } = require('../../utils/cloud.js');

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
    list: [],
    headerOrderTitle: '订单',
    orderIdFilter: '',
    targetDisputeId: '',
    shouldBackToOrderDetail: false,
    settlementModalVisible: false,
    settlementDisputeId: '',
    settlementTotalDeposit: 0,
    settlementStudentDeposit: 0,
    settlementPublisherDeposit: 0,
    settlementToStudent: '',
    settlementToPublisher: ''
  },

  onLoad(options) {
    this.setData({
      orderIdFilter: String((options && options.orderId) || '').trim(),
      targetDisputeId: String((options && options.disputeId) || '').trim(),
      shouldBackToOrderDetail: String((options && options.orderId) || '').trim().length > 0
    });
  },

  onShow() {
    this.load();
  },

  afterResolveSuccess(message) {
    wx.showToast({ title: message || '已完成处理', icon: 'success' });
    if (this.data.shouldBackToOrderDetail && this.data.orderIdFilter) {
      setTimeout(() => {
        wx.redirectTo({
          url: `/pages/admin/order-detail?id=${encodeURIComponent(this.data.orderIdFilter)}`
        });
      }, 350);
      return;
    }
    this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  async load() {
    try {
      const r = await call('job', { action: 'adminListPendingDisputes' });
      let list = r.list || [];
      const orderIdFilter = this.data.orderIdFilter;
      if (orderIdFilter) {
        list = list.filter((item) => String(item.orderId || '') === orderIdFilter);
      }
      const targetDisputeId = this.data.targetDisputeId;
      if (targetDisputeId) {
        list = list.map((item) => ({
          ...item,
          focused: String(item._id || '') === targetDisputeId
        }));
      }
      const fileUrlMap = await resolveCloudFileUrls([
        ...list.map((item) => item.submitPhotoFileId),
        ...list.map((item) => item.disputePhotoFileId)
      ]);
      list = list.map((item) => ({
        ...item,
        // UI绑定字段：按产品定义统一命名
        orderTitle: item.jobTitle || '未命名订单',
        orderId: item.orderId || '',
        orderStatus: item.orderSummary || '',
        complainant: item.complainantName || '—',
        respondent: item.respondentName || '—',
        disputeReason: item.reason || '',
        selectedOption: item.selectedOption || '',
        submitPhotoUrl: item.submitPhotoUrl || fileUrlMap[item.submitPhotoFileId] || item.submitPhotoFileId || '',
        disputePhotoUrl: item.disputePhotoUrl || fileUrlMap[item.disputePhotoFileId] || item.disputePhotoFileId || ''
      }));
      this.setData({
        list,
        headerOrderTitle: (list[0] && list[0].orderTitle) || '订单'
      });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
    }
  },

  onApprove(e) {
    const disputeId = e.currentTarget.dataset.id;
    if (!disputeId) return;
    wx.showModal({
      title: '采纳投诉',
      editable: true,
      placeholderText: '管理员备注（选填）',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中' });
        try {
          const r = await call('job', {
            action: 'adminResolveDispute',
            disputeId,
            approve: true,
            adminNote: res.content || ''
          });
          this.afterResolveSuccess((r && r.message) || '已完成处理');
        } catch (err) {
          wx.showToast({ title: (err && err.message) || '失败', icon: 'none' });
        } finally {
          wx.hideLoading();
        }
      }
    });
  },

  async onReturnDeposits(e) {
    const disputeId = String(e.currentTarget.dataset.id || '').trim();
    if (!disputeId) return;
    const item = (this.data.list || []).find((x) => x._id === disputeId);
    if (!item) return;
    const studentDeposit = Number(item.studentDeposit || 0);
    const publisherPerOrderDeposit = Number(item.publisherPerOrderDeposit || 0);
    if (studentDeposit <= 0 || publisherPerOrderDeposit <= 0) {
      wx.showToast({ title: '订单押金数据异常', icon: 'none' });
      return;
    }
    const settlement = {
      studentDepositToStudent: studentDeposit,
      studentDepositToPublisher: 0,
      publisherDepositToStudent: 0,
      publisherDepositToPublisher: publisherPerOrderDeposit
    };
    await this.resolveWithSettlement(disputeId, item, settlement, '押金原路返回');
  },

  quickResolveByPreset(e) {
    const disputeId = e.currentTarget.dataset.id;
    const preset = String(e.currentTarget.dataset.preset || '').trim();
    if (!disputeId || !preset) return;
    const item = (this.data.list || []).find((x) => x._id === disputeId);
    if (!item) return;
    const studentDeposit = Number(item.studentDeposit || 0);
    const publisherPerOrderDeposit = Number(item.publisherPerOrderDeposit || 0);
    if (studentDeposit <= 0 || publisherPerOrderDeposit <= 0) {
      wx.showToast({ title: '订单押金数据异常', icon: 'none' });
      return;
    }
    let settlement = null;
    if (preset === 'student_all') {
      settlement = {
        studentDepositToStudent: studentDeposit,
        studentDepositToPublisher: 0,
        publisherDepositToStudent: publisherPerOrderDeposit,
        publisherDepositToPublisher: 0
      };
    } else if (preset === 'publisher_all') {
      settlement = {
        studentDepositToStudent: 0,
        studentDepositToPublisher: studentDeposit,
        publisherDepositToStudent: 0,
        publisherDepositToPublisher: publisherPerOrderDeposit
      };
    } else if (preset === 'half_half') {
      const studentHalf = Math.floor(studentDeposit / 2);
      const publisherHalf = Math.floor(publisherPerOrderDeposit / 2);
      settlement = {
        studentDepositToStudent: studentHalf,
        studentDepositToPublisher: studentDeposit - studentHalf,
        publisherDepositToStudent: publisherHalf,
        publisherDepositToPublisher: publisherPerOrderDeposit - publisherHalf
      };
    }
    if (!settlement) return;
    this.resolveWithSettlement(disputeId, item, settlement, '快速分配处理');
  },

  onSelectQuickOption(e) {
    const disputeId = String(e.currentTarget.dataset.id || '').trim();
    const preset = String(e.currentTarget.dataset.preset || '').trim();
    if (!disputeId || !preset) return;
    const list = (this.data.list || []).map((item) => {
      if (item._id !== disputeId) return item;
      return { ...item, selectedOption: preset };
    });
    this.setData({ list });
    this.quickResolveByPreset(e);
  },

  onReject(e) {
    const disputeId = e.currentTarget.dataset.id;
    if (!disputeId) return;
    wx.showModal({
      title: '驳回投诉',
      editable: true,
      placeholderText: '驳回原因（选填）',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中' });
        try {
          const r = await call('job', {
            action: 'adminResolveDispute',
            disputeId,
            approve: false,
            adminNote: res.content || ''
          });
          this.afterResolveSuccess((r && r.message) || '已完成处理');
        } catch (err) {
          wx.showToast({ title: (err && err.message) || '失败', icon: 'none' });
        } finally {
          wx.hideLoading();
        }
      }
    });
  },

  async onManualResolve(e) {
    const disputeId = e.currentTarget.dataset.id;
    if (!disputeId) return;
    const item = (this.data.list || []).find((x) => x._id === disputeId);
    if (!item) return;
    const studentDeposit = Number(item.studentDeposit || 0);
    const publisherPerOrderDeposit = Number(item.publisherPerOrderDeposit || 0);
    if (studentDeposit <= 0 || publisherPerOrderDeposit <= 0) {
      wx.showToast({ title: '订单押金数据异常', icon: 'none' });
      return;
    }
    const totalDeposit = Number(item.totalDeposit || 0) || (studentDeposit + publisherPerOrderDeposit);
    const defaultToStudent = Math.floor(totalDeposit / 2);
    this.setData({
      settlementModalVisible: true,
      settlementDisputeId: disputeId,
      settlementTotalDeposit: totalDeposit,
      settlementStudentDeposit: studentDeposit,
      settlementPublisherDeposit: publisherPerOrderDeposit,
      settlementToStudent: String(defaultToStudent),
      settlementToPublisher: String(totalDeposit - defaultToStudent)
    });
  },

  onSettlementInputToStudent(e) {
    this.setData({ settlementToStudent: String((e.detail && e.detail.value) || '').trim() });
  },

  onSettlementInputToPublisher(e) {
    this.setData({ settlementToPublisher: String((e.detail && e.detail.value) || '').trim() });
  },

  closeSettlementModal() {
    this.setData({
      settlementModalVisible: false,
      settlementDisputeId: '',
      settlementTotalDeposit: 0,
      settlementStudentDeposit: 0,
      settlementPublisherDeposit: 0,
      settlementToStudent: '',
      settlementToPublisher: ''
    });
  },

  async submitSettlementModal() {
    const disputeId = String(this.data.settlementDisputeId || '').trim();
    const totalDeposit = Number(this.data.settlementTotalDeposit || 0);
    const studentDeposit = Number(this.data.settlementStudentDeposit || 0);
    const publisherDeposit = Number(this.data.settlementPublisherDeposit || 0);
    if (!disputeId || totalDeposit <= 0 || studentDeposit <= 0 || publisherDeposit <= 0) {
      wx.showToast({ title: '分配数据异常，请重试', icon: 'none' });
      return;
    }
    const toStudent = parseInt(String(this.data.settlementToStudent || '').trim(), 10);
    const toPublisher = parseInt(String(this.data.settlementToPublisher || '').trim(), 10);
    if (!Number.isInteger(toStudent) || !Number.isInteger(toPublisher) || toStudent < 0 || toPublisher < 0) {
      wx.showToast({ title: '请输入非负整数金额', icon: 'none' });
      return;
    }
    if (toStudent + toPublisher !== totalDeposit) {
      wx.showToast({ title: `两者相加需等于总押金 ${totalDeposit}`, icon: 'none' });
      return;
    }

    const studentDepositToStudent = Math.min(studentDeposit, toStudent);
    const publisherDepositToStudent = toStudent - studentDepositToStudent;
    const studentDepositToPublisher = studentDeposit - studentDepositToStudent;
    const publisherDepositToPublisher = publisherDeposit - publisherDepositToStudent;
    if (publisherDepositToStudent < 0 || publisherDepositToPublisher < 0) {
      wx.showToast({ title: '分配金额超出押金范围', icon: 'none' });
      return;
    }

    const item = (this.data.list || []).find((x) => x._id === disputeId);
    this.closeSettlementModal();
    await this.resolveWithSettlement(disputeId, item || {}, {
      studentDepositToStudent,
      studentDepositToPublisher,
      publisherDepositToStudent,
      publisherDepositToPublisher
    }, '人工裁定处理');
  },

  async resolveWithSettlement(disputeId, item, settlement, resolveTitle) {
    const studentGain = Number(settlement.studentDepositToStudent || 0) + Number(settlement.publisherDepositToStudent || 0);
    const publisherGain = Number(settlement.studentDepositToPublisher || 0) + Number(settlement.publisherDepositToPublisher || 0);
    const confirmRes = await new Promise((resolve) => {
      wx.showModal({
        title: resolveTitle || '确认分配方案',
        content: `兼职方将获得 ${studentGain} 工分，发布方将获得 ${publisherGain} 工分。确认提交？`,
        confirmText: '确认提交',
        cancelText: '返回修改',
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!confirmRes.confirm) return;

    const note = await this.inputText('管理员备注（建议填写）', '');
    if (note === null) return;
    wx.showLoading({ title: '处理中' });
    try {
      const r = await call('job', {
        action: 'adminResolveDispute',
        disputeId,
        approve: true,
        adminNote: note || '',
        settlement
      });
      this.afterResolveSuccess((r && r.message) || '已完成处理');
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  inputInt(title, placeholderText) {
    return new Promise((resolve) => {
      wx.showModal({
        title,
        editable: true,
        placeholderText,
        success: (res) => {
          if (!res.confirm) return resolve(null);
          const v = parseInt((res.content || '').trim(), 10);
          if (!Number.isFinite(v) || v < 0) {
            wx.showToast({ title: '请输入非负整数', icon: 'none' });
            return resolve(null);
          }
          resolve(v);
        },
        fail: () => resolve(null)
      });
    });
  },

  inputText(title, placeholderText) {
    return new Promise((resolve) => {
      wx.showModal({
        title,
        editable: true,
        placeholderText,
        success: (res) => {
          if (!res.confirm) return resolve(null);
          resolve((res.content || '').trim());
        },
        fail: () => resolve(null)
      });
    });
  }
});
