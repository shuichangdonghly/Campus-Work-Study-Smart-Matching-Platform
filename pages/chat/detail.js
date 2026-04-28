const { call } = require('../../utils/cloud.js');

function formatTime(value) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatDivider(value) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  if (sameDay) return `今天 ${formatTime(value)}`;
  return `${month}/${day} ${formatTime(value)}`;
}

function makeAvatarText(name) {
  const str = String(name || '').trim();
  if (!str) return '聊';
  return str.slice(0, 1).toUpperCase();
}

function resolveDisplayName(user) {
  if (!user) return '我';
  const studentPayload = user.studentVerifyPayload || {};
  const publisherPayload = user.publisherVerifyPayload || {};
  const verifyPayload = user.verifyPayload || {};
  return (
    studentPayload.realName ||
    publisherPayload.unitName ||
    verifyPayload.realName ||
    verifyPayload.unitName ||
    user.nickName ||
    '我'
  );
}

function normalizeMessages(list, meOpenid) {
  let prevTime = 0;
  return (list || []).map((item) => {
    const t = new Date(item.createTime || 0).getTime() || 0;
    const showDivider = !prevTime || t - prevTime > 5 * 60 * 1000;
    prevTime = t || prevTime;
    return {
      ...item,
      isMine: item.fromOpenid === meOpenid,
      timeText: formatTime(item.createTime),
      dividerText: showDivider ? formatDivider(item.createTime) : '',
      showDivider
    };
  });
}

Page({
  data: {
    jobId: '',
    peerOpenid: '',
    list: [],
    text: '',
    meOpenid: '',
    meName: '我',
    peerName: '对方',
    jobTitle: '在线沟通',
    meAvatarText: '我',
    peerAvatarText: '对',
    sending: false
  },

  onLoad(options) {
    this.setData({
      jobId: options.jobId || '',
      peerOpenid: options.peerOpenid || ''
    });
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  async load() {
    const { jobId, peerOpenid } = this.data;
    if (!jobId || !peerOpenid) return;
    try {
      const [r, profile, peerProfile, jobRes] = await Promise.all([
        call('job', { action: 'listMessages', jobId, peerOpenid }),
        call('user', { action: 'getProfile' }),
        call('user', { action: 'getPublicProfile', targetOpenid: peerOpenid }),
        call('job', { action: 'getJob', jobId })
      ]);
      const me = profile.user || {};
      const peer = (peerProfile && peerProfile.profile) || {};
      const meName = resolveDisplayName(me);
      const peerName = String(peer.nickName || '').trim() || '对方';
      const meOpenid = me.openid || '';
      this.setData({
        list: normalizeMessages(r.list || [], meOpenid),
        meOpenid,
        meName,
        peerName,
        jobTitle: (jobRes.job && jobRes.job.title) || '在线沟通',
        meAvatarText: makeAvatarText(meName),
        peerAvatarText: makeAvatarText(peerName)
      });
      wx.setNavigationBarTitle({ title: peerName });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
    }
  },

  onInput(e) {
    this.setData({ text: e.detail.value });
  },

  async send() {
    const { jobId, peerOpenid, text } = this.data;
    if (!text.trim() || this.data.sending) return;
    this.setData({ sending: true });
    try {
      await call('job', {
        action: 'sendMessage',
        jobId,
        toOpenid: peerOpenid,
        text: text.trim()
      });
      this.setData({ text: '' });
      await this.load();
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '发送失败', icon: 'none' });
    } finally {
      this.setData({ sending: false });
    }
  }
});
