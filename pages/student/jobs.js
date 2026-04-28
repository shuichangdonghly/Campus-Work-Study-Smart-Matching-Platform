const { call } = require('../../utils/cloud.js');
const JOB_CATEGORIES = ['菜鸟驿站', '奶茶店', '实验室助手', '校外家教', '图书馆管理员', '活动协助', '其他'];

Page({
  data: {
    list: [],
    filteredList: [],
    activeCategory: '全部',
    categories: ['全部', ...JOB_CATEGORIES]
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  async load() {
    try {
      const r = await call('job', { action: 'listOpenJobs' });
      const list = r.list || [];
      this.setData({ list }, () => this.applyFilter());
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
    }
  },

  pickCategory(e) {
    const category = e.currentTarget.dataset.category || '全部';
    this.setData({ activeCategory: category }, () => this.applyFilter());
  },

  applyFilter() {
    const { list, activeCategory } = this.data;
    if (activeCategory === '全部') {
      this.setData({ filteredList: list });
      return;
    }
    if (activeCategory === '其他') {
      const filteredList = list.filter((item) => {
        const c = (item.category || '').trim();
        if (!c) return true;
        return JOB_CATEGORIES.indexOf(c) === -1 || c === '其他';
      });
      this.setData({ filteredList });
      return;
    }
    const filteredList = list.filter((item) => {
      const c = item.category || '';
      return c.indexOf(activeCategory) !== -1;
    });
    this.setData({ filteredList });
  },

  open(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/student/job-detail?id=' + id });
  },

  goJobs() {
    // 当前页
  },

  goRecommend() {
    wx.navigateTo({ url: '/pages/student/recommend/recommend' });
  },

  goContact() {
    wx.redirectTo({ url: '/pages/student/contact' });
  },

  goMine() {
    wx.redirectTo({ url: '/pages/student/mine' });
  }
});
