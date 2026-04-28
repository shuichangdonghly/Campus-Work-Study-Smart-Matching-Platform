const { call } = require('../../utils/cloud.js');
const STATUS_TEXT = {
  ongoing: '进行中',
  pending_settlement: '待交易',
  submitted: '待交易',
  completed: '已结束',
  closed: '已关闭（爽约）',
  publisher_cancelled: '发布者已下架',
  admin_cancelled: '管理员取消订单'
};

Page({
  data: {
    list: [],
    signCodeMap: {},
    expandedOrderId: ''
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  async load() {
    try {
      const r = await call('job', { action: 'myWorkOrders' });
      const list = (r.list || []).map((item) => ({
        ...item,
        statusText: STATUS_TEXT[item.status] || item.status || '未知状态',
        signTimeText: item.signTime ? this.formatTime(item.signTime) : '未签到',
        submitTimeText: item.submitTime ? this.formatTime(item.submitTime) : '未提交',
        submitTextDisplay: item.submitText ? String(item.submitText).trim() : '暂无'
      }));
      this.setData({ list });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
    }
  },

  submit(e) {
    const id = e.currentTarget.dataset.id;
    const item = (this.data.list || []).find((o) => o._id === id);
    if (!item || !item.signTime) {
      wx.showToast({ title: '请先完成现场签到', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/work/submit?id=' + id });
  },

  onSignCodeInput(e) {
    const orderId = e.currentTarget.dataset.id;
    const value = (e.detail.value || '').trim();
    this.setData({
      signCodeMap: {
        ...this.data.signCodeMap,
        [orderId]: value
      }
    });
  },

  async signIn(e) {
    const orderId = e.currentTarget.dataset.id;
    const signCode = (this.data.signCodeMap[orderId] || '').trim();
    if (!signCode) {
      wx.showToast({ title: '请输入签到码', icon: 'none' });
      return;
    }
    if (!/^\d{6}$/.test(signCode)) {
      wx.showToast({ title: '签到码应为6位数字', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '签到中' });
    try {
      await call('signIn', { orderId, signCode });
      wx.showToast({ title: '签到成功', icon: 'success' });
      this.load();
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '签到失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  inputText(title, placeholder) {
    return new Promise((resolve) => {
      wx.showModal({
        title,
        editable: true,
        placeholderText: placeholder,
        success: (res) => {
          if (!res.confirm) return resolve(null);
          resolve((res.content || '').trim());
        },
        fail: () => resolve(null)
      });
    });
  },

  inputTextRequired(title, placeholder) {
    return new Promise((resolve) => {
      wx.showModal({
        title,
        editable: true,
        placeholderText: placeholder,
        success: (res) => {
          if (!res.confirm) return resolve(null);
          const value = (res.content || '').trim();
          if (!value) {
            wx.showToast({ title: '请填写说明', icon: 'none' });
            return resolve(null);
          }
          resolve(value);
        },
        fail: () => resolve(null)
      });
    });
  },

  runReportMerchantNoPayByEvent(e) {
    const orderId = e.currentTarget.dataset.id;
    if (!orderId) return;
    this.runReportMerchantNoPay(orderId);
  },

  openAppeal(e) {
    const orderId = e.currentTarget.dataset.id;
    if (!orderId) return;
    const item = (this.data.list || []).find((o) => o._id === orderId);
    if (!item) return;
    // 已提交完工后可投诉拒不付款；签到后未完工阶段走通用纠纷投诉，不改变订单结算态
    if (item.status === 'pending_settlement' || item.status === 'submitted') {
      this.runReportMerchantNoPay(orderId);
      return;
    }
    this.runReportOtherDispute(orderId);
  },

  async runReportMerchantNoPay(orderId) {
    const reason = await this.inputTextRequired('申诉原因', '');
    if (reason === null) return;
    const photoFileId = await this.pickAppealPhotoAndUpload(orderId);
    if (photoFileId === null) return;
    wx.showLoading({ title: '提交中' });
    try {
      await call('job', { action: 'reportMerchantNoPay', orderId, reason, photoFileId });
      await this.showAppealUploadedModal();
      this.load();
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '提交失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async runReportOtherDispute(orderId) {
    const reason = await this.inputTextRequired('投诉原因', '');
    if (reason === null) return;
    wx.showLoading({ title: '提交中' });
    try {
      await call('job', { action: 'reportOtherDispute', orderId, reason });
      await this.showAppealUploadedModal();
      this.load();
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '提交失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  pickAppealPhotoAndUpload(orderId) {
    return new Promise((resolve) => {
      wx.showActionSheet({
        itemList: ['选择照片并上传（可选）', '不上传，直接提交'],
        success: (res) => {
          if (res.tapIndex === 1) {
            return resolve('');
          }
          wx.chooseMedia({
            count: 1,
            mediaType: ['image'],
            success: async (res) => {
              const tempFile = res.tempFiles && res.tempFiles[0];
              const tempPath = tempFile && tempFile.tempFilePath;
              if (!tempPath) {
                wx.showToast({ title: '未选择图片', icon: 'none' });
                return resolve(null);
              }
              wx.showLoading({ title: '上传图片中' });
              try {
                const up = await wx.cloud.uploadFile({
                  cloudPath: `appeal-proof/${orderId}/${Date.now()}.jpg`,
                  filePath: tempPath
                });
                resolve(up.fileID || '');
              } catch (e) {
                wx.showToast({ title: (e && e.message) || '图片上传失败', icon: 'none' });
                resolve(null);
              } finally {
                wx.hideLoading();
              }
            },
            fail: () => resolve('')
          });
        },
        fail: () => resolve(null)
      });
    });
  },

  viewDetail(e) {
    const id = e.currentTarget.dataset.id;
    const item = (this.data.list || []).find((o) => o._id === id);
    if (!item) {
      wx.showToast({ title: '工单不存在', icon: 'none' });
      return;
    }
    const expandedOrderId = this.data.expandedOrderId === id ? '' : id;
    this.setData({ expandedOrderId });
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
  },

  formatTime(value) {
    if (!value) return '';
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
