const { call } = require('../../utils/cloud.js');

const PRESET_AMOUNTS = [20, 50, 100, 200, 500];

Page({
  data: {
    presetAmounts: PRESET_AMOUNTS,
    selectedAmount: 100,
    customAmount: '',
    useCustom: false,
    user: null,
    logs: []
  },

  onShow() {
    this.refresh();
  },

  async refresh() {
    try {
      const [profileRes, logRes] = await Promise.all([
        call('user', { action: 'getProfile' }),
        call('user', { action: 'walletLogs' })
      ]);
      this.setData({
        user: profileRes.user || null,
        logs: (logRes.list || []).filter((x) => x.type === 'recharge').slice(0, 8)
      });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
    }
  },

  selectPreset(e) {
    const amount = parseInt(e.currentTarget.dataset.amount, 10) || 0;
    this.setData({
      selectedAmount: amount,
      useCustom: false
    });
  },

  onCustomInput(e) {
    this.setData({
      customAmount: e.detail.value || '',
      useCustom: true
    });
  },

  resolveAmount() {
    if (this.data.useCustom) {
      return parseInt(this.data.customAmount, 10);
    }
    return parseInt(this.data.selectedAmount, 10);
  },

  async submitRecharge() {
    const amount = this.resolveAmount();
    if (!amount || amount < 1) {
      wx.showToast({ title: '请输入正确金额', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '充值中' });
    try {
      await call('user', { action: 'recharge', amount });
      wx.showToast({ title: '充值完成，工分已增加', icon: 'success' });
      this.setData({ customAmount: '', useCustom: false });
      await this.refresh();
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '充值失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  }
});
