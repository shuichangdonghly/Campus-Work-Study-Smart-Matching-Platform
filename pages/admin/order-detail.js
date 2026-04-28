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
    loading: true,
    adminPhaseLabel: '',
    adminPhaseKey: '',
    job: null,
    order: null,
    studentLabel: '',
    publisherLabel: '',
    disputes: [],
    canAdminCancelTrade: false,
    cancelTradeDisabled: false
  },

  onLoad(options) {
    const id = String(options.id || '').trim();
    const jobId = String(options.jobId || '').trim();
    if (!id && !jobId) {
      wx.showToast({ title: '缺少订单/岗位', icon: 'none' });
      this.setData({ loading: false });
      return;
    }
    this.orderId = id;
    this.jobId = jobId;
    this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      const r = this.orderId
        ? await call('job', { action: 'adminGetWorkOrderDetail', orderId: this.orderId })
        : await call('job', { action: 'adminGetJobOrderDetail', jobId: this.jobId });
      const rawOrder = {
        ...r.order,
        submitTimeText: this.formatTime(r.order && r.order.submitTime)
      };
      const rawDisputes = r.disputes || [];
      const fileIdList = [
        rawOrder.submitPhotoFileId,
        ...rawDisputes.map((d) => d.disputePhotoFileId)
      ];
      const fileUrlMap = await resolveCloudFileUrls(fileIdList);
      const jobStatus = String((r.job && r.job.status) || '').trim();
      const orderStatus = String((r.order && r.order.status) || '').trim();
      const isCancelled =
        ['admin_cancelled', 'publisher_cancelled'].includes(jobStatus)
        || ['admin_cancelled', 'publisher_cancelled'].includes(orderStatus);
      this.setData({
        adminPhaseLabel: r.adminPhaseLabel || '—',
        adminPhaseKey: r.adminPhaseKey || 'done',
        job: r.job,
        order: {
          ...rawOrder,
          submitPhotoUrl: rawOrder.submitPhotoUrl || fileUrlMap[rawOrder.submitPhotoFileId] || rawOrder.submitPhotoFileId || ''
        },
        studentLabel: r.studentLabel || '—',
        publisherLabel: r.publisherLabel || '—',
        disputes: rawDisputes.map((d) => ({
          ...d,
          disputePhotoUrl: d.disputePhotoUrl || fileUrlMap[d.disputePhotoFileId] || d.disputePhotoFileId || ''
        })),
        canAdminCancelTrade: !!(r.job && r.job._id),
        cancelTradeDisabled: !!isCancelled,
        loading: false
      });
    } catch (e) {
      const msg = String((e && e.message) || '');
      if (msg.includes('未知 action')) {
        await this.loadLegacy();
        return;
      }
      this.setData({ loading: false });
      wx.showToast({ title: msg || '加载失败', icon: 'none' });
    }
  },

  async loadLegacy() {
    try {
      const [ordersRes, disputesRes] = await Promise.all([
        call('job', { action: 'adminListAllWorkOrders', orderStatus: 'all' }),
        call('job', { action: 'adminListPendingDisputes' })
      ]);
      const order = (ordersRes.list || []).find((item) => item._id === this.orderId);
      if (!order) {
        this.setData({ loading: false });
        wx.showToast({ title: '订单不存在', icon: 'none' });
        return;
      }
      const disputes = (disputesRes.list || []).filter((d) => d.orderId === this.orderId);
      const fileUrlMap = await resolveCloudFileUrls([
        order.submitPhotoFileId,
        ...disputes.map((d) => d.disputePhotoFileId)
      ]);
      this.setData({
        adminPhaseLabel: order.statusText || order.status || '—',
        adminPhaseKey: 'done',
        job: {
          title: order.jobTitle || '岗位',
          location: '',
          timeDesc: ''
        },
        order: {
          rewardPoints: order.rewardPoints,
          submitText: order.submitText || '',
          submitPhotoFileId: order.submitPhotoFileId || '',
          submitPhotoUrl: order.submitPhotoUrl || fileUrlMap[order.submitPhotoFileId] || order.submitPhotoFileId || '',
          submitTimeText: this.formatTime(order.submitTime),
          noShowReason: order.noShowReason || ''
        },
        studentLabel: order.studentLabel || '—',
        publisherLabel: order.publisherLabel || '—',
        disputes: disputes.map((d) => ({
          ...d,
          disputePhotoUrl: d.disputePhotoUrl || fileUrlMap[d.disputePhotoFileId] || d.disputePhotoFileId || ''
        })),
        canAdminCancelTrade: false,
        cancelTradeDisabled: true,
        loading: false
      });
      wx.showToast({ title: '已启用兼容加载', icon: 'none' });
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({ title: (err && err.message) || '加载失败', icon: 'none' });
    }
  },

  goHandleDispute(e) {
    const disputeId = String(e.currentTarget.dataset.disputeid || '').trim();
    const orderId = String(this.orderId || '').trim();
    if (!disputeId) return;
    const qs = `?orderId=${encodeURIComponent(orderId)}&disputeId=${encodeURIComponent(disputeId)}`;
    wx.navigateTo({ url: `/pages/admin/disputes${qs}` });
  },

  async cancelTradeByAdmin() {
    if (!this.data.canAdminCancelTrade || this.data.cancelTradeDisabled || !this.data.job || !this.data.job._id) return;
    const reasonRes = await new Promise((resolve) => {
      wx.showModal({
        title: '取消交易原因',
        editable: true,
        placeholderText: '例如：岗位信息不实',
        confirmText: '确认取消',
        cancelText: '再想想',
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!reasonRes.confirm) return;
    wx.showLoading({ title: '处理中' });
    try {
      const r = await call('job', {
        action: 'adminCancelJobTrade',
        jobId: this.data.job._id,
        reason: reasonRes.content || ''
      });
      wx.showToast({ title: (r && r.message) || '已取消交易', icon: 'none' });
      this.load();
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '取消失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  formatTime(value) {
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
});
