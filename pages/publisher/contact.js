const { call } = require('../../utils/cloud.js');
const UNVERIFIED_TIP = '当前未认证，请先前往我的信息去认证';

function formatChatTime(value) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (sameDay) return `${hh}:${mm}`;
  const month = d.getMonth() + 1;
  const day = d.getDate();
  return `${month}/${day}`;
}

function pickPeerNick(peerUser, fallback) {
  const n = peerUser && String(peerUser.nickName || '').trim();
  return n || fallback;
}

function buildAvatarText(item) {
  const name = pickPeerNick(item.peerUser, '');
  if (!name) return '聊';
  return name.slice(0, 1).toUpperCase();
}

function normalizeChat(item) {
  const msg = String(item.text || '').trim() || '暂时还没有消息';
  return {
    ...item,
    peerName: pickPeerNick(item.peerUser, '兼职者'),
    jobTitle: (item.job && item.job.title) || '未命名岗位',
    preview: msg.length > 26 ? `${msg.slice(0, 26)}...` : msg,
    timeText: formatChatTime(item.createTime),
    avatarText: buildAvatarText(item)
  };
}

Page({
  data: {
    list: [],
    user: null
  },

  onShow() {
    this.load();
  },

  async load() {
    try {
      const p = await call('user', { action: 'getProfile' });
      const user = p.user || null;
      if (!user || user.verifyStatus !== 'approved') {
        wx.showToast({ title: UNVERIFIED_TIP, icon: 'none' });
        this.setData({ user, list: [] });
        return;
      }
      const r = await call('job', { action: 'listMyChats' });
      this.setData({ user, list: (r.list || []).map(normalizeChat) });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
    }
  },

  openChat(e) {
    const u = this.data.user;
    if (!u || u.verifyStatus !== 'approved') {
      wx.showToast({ title: UNVERIFIED_TIP, icon: 'none' });
      return;
    }
    const jobId = e.currentTarget.dataset.jobid;
    const peerOpenid = e.currentTarget.dataset.peeropenid;
    if (!jobId || !peerOpenid) return;
    wx.navigateTo({
      url: `/pages/chat/detail?jobId=${jobId}&peerOpenid=${peerOpenid}`
    });
  },

  goPublish() {
    wx.redirectTo({ url: '/pages/publisher/jobs' });
  },

  goContact() {
    // 当前页
  },

  goMine() {
    wx.redirectTo({ url: '/pages/publisher/mine' });
  }
});
