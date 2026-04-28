const { call } = require('../../utils/cloud.js');

Page({
  data: {
    orderFilter: 'all',
    orderList: [],
    orderFilters: [
      { key: 'all', label: '全部', tone: 'neutral' },
      { key: 'dispute', label: '申诉(0)', tone: 'dispute' },
      { key: 'recruiting', label: '招募中', tone: 'recruiting' },
      { key: 'in_progress', label: '进行中', tone: 'progress' },
      { key: 'settling', label: '结算中', tone: 'settling' },
      { key: 'done', label: '已完成', tone: 'done' }
    ]
  },

  onShow() {
    this.refresh();
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh());
  },

  setOrderFilter(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.orderFilter) return;
    this.setData({ orderFilter: key }, () => this.loadOrders());
  },

  async refresh() {
    await this.loadOrders();
  },

  async loadOrders() {
    try {
      const r = await call('job', {
        action: 'adminListAllWorkOrders',
        adminPhase: this.data.orderFilter
      });
      const disputeCount = parseInt(r.disputeOrderCount || 0, 10) || 0;
      const orderFilters = this.data.orderFilters.map((f) => {
        if (f.key !== 'dispute') return f;
        return { ...f, label: `申诉(${disputeCount})` };
      });
      this.setData({ orderList: r.list || [], orderFilters });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
    }
  },

  openDetail(e) {
    const orderId = String(e.currentTarget.dataset.orderid || '').trim();
    const jobId = String(e.currentTarget.dataset.jobid || '').trim();
    if (!orderId && !jobId) {
      wx.showToast({ title: '缺少岗位信息', icon: 'none' });
      return;
    }
    const qs = `?id=${encodeURIComponent(orderId)}&jobId=${encodeURIComponent(jobId)}`;
    wx.navigateTo({ url: '/pages/admin/order-detail' + qs });
  },

  goAudit() {
    wx.redirectTo({ url: '/pages/admin/audit' });
  },

  goMine() {
    wx.redirectTo({ url: '/pages/admin/mine' });
  }
});
