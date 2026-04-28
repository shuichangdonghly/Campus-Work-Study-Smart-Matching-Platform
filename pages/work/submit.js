const { call } = require('../../utils/cloud.js');

Page({
  data: {
    orderId: '',
    tempPath: '',
    text: '',
    uploading: false
  },

  onLoad(options) {
    this.setData({ orderId: options.id || '' });
  },

  onText(e) {
    this.setData({ text: e.detail.value });
  },

  pickImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: (res) => {
        const p = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath;
        if (p) this.setData({ tempPath: p });
      }
    });
  },

  async submit() {
    const { orderId, tempPath, text } = this.data;
    if (!orderId) {
      wx.showToast({ title: '缺少工单', icon: 'none' });
      return;
    }
    if (!tempPath) {
      wx.showToast({ title: '请先选择照片', icon: 'none' });
      return;
    }
    const cloudPath = `work-proof/${orderId}/${Date.now()}.jpg`;
    this.setData({ uploading: true });
    wx.showLoading({ title: '上传中' });
    try {
      const up = await wx.cloud.uploadFile({
        cloudPath,
        filePath: tempPath
      });
      await call('job', {
        action: 'submitWork',
        orderId,
        photoFileId: up.fileID,
        text: text.trim()
      });
      wx.showToast({ title: '已提交', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (e) {
      wx.showToast({
        title: (e && e.message) || '提交失败',
        icon: 'none'
      });
    } finally {
      wx.hideLoading();
      this.setData({ uploading: false });
    }
  }
});
