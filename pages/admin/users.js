const { call } = require('../../utils/cloud.js');

Page({
  data: {
    list: []
  },

  onShow() {
    this.load();
  },

  async load() {
    try {
      const r = await call('user', { action: 'adminListPendingUsers' });
      const list = (r.list || []).map((u) => {
        const p = u.verifyPayload || {};
        let displayName = u.nickName || '微信用户';
        let details = [];
        if (u.applyRole === 'student') {
          displayName = p.realName || displayName;
          details = [
            { label: '学号', value: p.studentNo || '未填写' },
            { label: '姓名', value: p.realName || '未填写' },
            { label: '专业', value: p.major || '未填写' },
            { label: '年级', value: p.grade || '未填写' }
          ];
        } else if (u.applyRole === 'publisher') {
          displayName = p.unitName || displayName;
          details = [
            { label: '工号/商户编号', value: p.workNo || '未填写' },
            { label: '单位/店铺', value: p.unitName || '未填写' },
            { label: '补充说明', value: p.remark || '未填写' }
          ];
        }
        const applyRoleLabel = u.applyRole === 'publisher' ? '发布者' : (u.applyRole === 'student' ? '兼职者' : '未设置');
        return { ...u, displayName, details, applyRoleLabel, applyKey: `${u.openid}_${u.applyRole}` };
      });
      this.setData({ list });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '无权限或加载失败', icon: 'none' });
    }
  },

  async approve(e) {
    const targetOpenid = e.currentTarget.dataset.oid;
    const applyRole = e.currentTarget.dataset.role;
    try {
      await call('user', { action: 'adminApproveUser', targetOpenid, applyRole });
      wx.showToast({ title: '已通过', icon: 'success' });
      this.load();
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '失败', icon: 'none' });
    }
  },

  reject(e) {
    const targetOpenid = e.currentTarget.dataset.oid;
    const applyRole = e.currentTarget.dataset.role;
    wx.showModal({
      title: '拒绝原因',
      editable: true,
      placeholderText: '选填',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await call('user', {
            action: 'adminRejectUser',
            targetOpenid,
            applyRole,
            reason: res.content || ''
          });
          wx.showToast({ title: '已拒绝', icon: 'success' });
          this.load();
        } catch (err) {
          wx.showToast({ title: (err && err.message) || '失败', icon: 'none' });
        }
      }
    });
  }
});
