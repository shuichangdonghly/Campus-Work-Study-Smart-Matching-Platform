const { call } = require('../../utils/cloud.js');
const APPLIED_JOB_IDS_KEY = 'studentAppliedJobIds';
const STUDENT_SELECTED_LOCATION_KEY = 'studentSelectedLocation';
const DEFAULT_MY_LOCATION = {
  latitude: 30.4746,
  longitude: 114.3524,
  name: '华中农业大学'
};

Page({
  data: {
    jobId: '',
    job: null,
    applied: false,
    canApply: false,
    applyTip: '仅认证学生可报名',
    studentDeposit: 0,
    myLocation: null,
    myLocationText: '',
    hasLocationAuth: false,
    mapCenterLat: 0,
    mapCenterLng: 0,
    mapMarkers: []
  },

  onLoad(options) {
    const id = options.id || '';
    this.setData({
      jobId: id,
      applied: this.hasLocalApplied(id)
    });
    this.initMyLocation();
    if (id) this.load(id);
  },

  onShow() {
    const { jobId } = this.data;
    if (jobId) {
      if (this.hasLocalApplied(jobId) && !this.data.applied) {
        this.setData({
          applied: true,
          canApply: false,
          applyTip: '你已报名该岗位'
        });
      }
      this.load(jobId);
    }
  },

  async initMyLocation() {
    const selected = this.getSelectedLocationFromStorage();
    if (selected) {
      this.setData({
        hasLocationAuth: false,
        myLocation: { latitude: selected.latitude, longitude: selected.longitude },
        myLocationText: selected.text || ''
      });
      this.refreshMapMarkers();
      return;
    }
    const ok = await this.ensureLocationAuth();
    if (!ok || !wx.canIUse('getLocation')) {
      this.setData({
        hasLocationAuth: false,
        myLocation: { latitude: DEFAULT_MY_LOCATION.latitude, longitude: DEFAULT_MY_LOCATION.longitude },
        myLocationText: DEFAULT_MY_LOCATION.name
      });
      this.refreshMapMarkers();
      return;
    }
    wx.getLocation({
      type: 'gcj02',
      isHighAccuracy: true,
      highAccuracyExpireTime: 3000,
      success: (res) => {
        const latitude = Number(res && res.latitude);
        const longitude = Number(res && res.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          this.setData({
            hasLocationAuth: false,
            myLocation: { latitude: DEFAULT_MY_LOCATION.latitude, longitude: DEFAULT_MY_LOCATION.longitude },
            myLocationText: DEFAULT_MY_LOCATION.name
          });
          this.refreshMapMarkers();
          return;
        }
        this.setData({
          hasLocationAuth: true,
          myLocation: { latitude, longitude },
          myLocationText: '我的位置'
        });
        this.refreshMapMarkers();
      },
      fail: () => {
        this.setData({
          hasLocationAuth: false,
          myLocation: { latitude: DEFAULT_MY_LOCATION.latitude, longitude: DEFAULT_MY_LOCATION.longitude },
          myLocationText: DEFAULT_MY_LOCATION.name
        });
        this.refreshMapMarkers();
      }
    });
  },

  getSelectedLocationFromStorage() {
    try {
      const loc = wx.getStorageSync(STUDENT_SELECTED_LOCATION_KEY);
      if (!loc) return null;
      const latitude = Number(loc.latitude);
      const longitude = Number(loc.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      return {
        latitude,
        longitude,
        text: String(loc.text || '').trim()
      };
    } catch (e) {
      return null;
    }
  },

  ensureLocationAuth() {
    return new Promise((resolve) => {
      wx.getSetting({
        success: (res) => {
          if (res && res.authSetting && res.authSetting['scope.userLocation']) {
            resolve(true);
            return;
          }
          wx.authorize({
            scope: 'scope.userLocation',
            success: () => resolve(true),
            fail: () => resolve(false)
          });
        },
        fail: () => resolve(false)
      });
    });
  },

  getJobLocation(job) {
    if (!job) return null;
    const latitude = Number(
      job.locationLat != null
        ? job.locationLat
        : (job.locationGeo && job.locationGeo.lat)
    );
    const longitude = Number(
      job.locationLng != null
        ? job.locationLng
        : (job.locationGeo && job.locationGeo.lng)
    );
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { latitude, longitude };
  },

  refreshMapMarkers() {
    const { job, myLocation } = this.data;
    const markers = [];
    const jobLoc = this.getJobLocation(job);
    let myLocForMarker = myLocation;
    if (jobLoc && myLocation) {
      const latDiff = Math.abs(jobLoc.latitude - myLocation.latitude);
      const lngDiff = Math.abs(jobLoc.longitude - myLocation.longitude);
      // 两个点重叠或极近时，轻微偏移“我的位置”以保证在地图上可见
      if (latDiff < 0.00008 && lngDiff < 0.00008) {
        myLocForMarker = {
          latitude: myLocation.latitude + 0.00018,
          longitude: myLocation.longitude + 0.00018
        };
      }
    }
    if (jobLoc) {
      markers.push({
        id: 1,
        latitude: jobLoc.latitude,
        longitude: jobLoc.longitude,
        title: job.locationText || job.locationAddress || job.location || '兼职地点',
        width: 28,
        height: 34,
        zIndex: 10,
        callout: {
          content: '兼职地点',
          color: '#ffffff',
          fontSize: 11,
          borderRadius: 4,
          bgColor: '#ef4444',
          padding: 4,
          display: 'ALWAYS'
        }
      });
    }
    if (myLocForMarker) {
      markers.push({
        id: 2,
        latitude: myLocForMarker.latitude,
        longitude: myLocForMarker.longitude,
        title: this.data.hasLocationAuth
          ? '我的位置'
          : (this.data.myLocationText ? `我的位置（${this.data.myLocationText}）` : `我的位置（默认：${DEFAULT_MY_LOCATION.name}）`),
        width: 24,
        height: 30,
        zIndex: 20,
        callout: {
          content: this.data.hasLocationAuth
            ? '我的位置'
            : (this.data.myLocationText ? `个人位置（${this.data.myLocationText}）` : '默认位置（华中农业大学）'),
          color: '#ffffff',
          fontSize: 11,
          borderRadius: 4,
          bgColor: '#3b82f6',
          padding: 4,
          display: 'ALWAYS'
        }
      });
    }
    const center = jobLoc || myLocation || null;
    this.setData({
      mapMarkers: markers,
      mapCenterLat: center ? center.latitude : 0,
      mapCenterLng: center ? center.longitude : 0
    });
  },

  getLocalAppliedJobIds() {
    try {
      const ids = wx.getStorageSync(APPLIED_JOB_IDS_KEY);
      if (Array.isArray(ids)) return ids;
      return [];
    } catch (e) {
      return [];
    }
  },

  hasLocalApplied(jobId) {
    if (!jobId) return false;
    const ids = this.getLocalAppliedJobIds();
    return ids.indexOf(jobId) > -1;
  },

  markLocalApplied(jobId) {
    if (!jobId) return;
    const ids = this.getLocalAppliedJobIds();
    if (ids.indexOf(jobId) > -1) return;
    ids.push(jobId);
    try {
      wx.setStorageSync(APPLIED_JOB_IDS_KEY, ids);
    } catch (e) {}
  },

  async load(jobId) {
    try {
      const [jobRes, profileRes] = await Promise.all([
        call('job', { action: 'getJob', jobId }),
        call('user', { action: 'getProfile' })
      ]);
      const user = profileRes.user || null;
      const job = jobRes.job || null;
      const applied = !!jobRes.applied || this.hasLocalApplied(jobId);
      const studentDeposit = Math.ceil(((job && job.rewardPoints) || 0) * 0.5);
      let canApply = !!(user && user.role === 'student' && user.verifyStatus === 'approved');
      let applyTip = '仅认证学生可报名';
      if (applied) {
        this.markLocalApplied(jobId);
        canApply = false;
        applyTip = '你已报名该岗位';
      } else if (canApply) {
        const balance = parseInt(user.pointsBalance || 0, 10) || 0;
        if (balance < studentDeposit) {
          canApply = false;
          applyTip = `工分不足，接单需押金 ${studentDeposit}`;
        } else {
          applyTip = `接单需冻结押金 ${studentDeposit} 工分`;
        }
      }
      this.setData({ job, applied, canApply, applyTip, studentDeposit });
      this.refreshMapMarkers();
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
    }
  },

  async apply() {
    if (this.data.applied) {
      wx.showToast({ title: '你已报名该兼职，请勿重复操作', icon: 'none' });
      return;
    }
    if (!this.data.canApply) {
      if (this.data.applyTip && this.data.applyTip.indexOf('工分不足') > -1) {
        const modalRes = await new Promise((resolve) => {
          wx.showModal({
            title: '工分不足',
            content: `${this.data.applyTip}，是否前往充值？`,
            confirmText: '前往充值',
            cancelText: '取消',
            success: resolve,
            fail: () => resolve({ confirm: false, cancel: true })
          });
        });
        if (modalRes.confirm) {
          wx.navigateTo({ url: '/pages/wallet/recharge' });
        }
        return;
      }
      wx.showToast({ title: this.data.applyTip, icon: 'none' });
      return;
    }
    const jobId = this.data.jobId;
    wx.showLoading({ title: '报名中' });
    try {
      const r = await call('job', { action: 'applyJob', jobId });
      this.markLocalApplied(jobId);
      this.setData({
        applied: true,
        canApply: false,
        applyTip: '你已报名该岗位'
      });
      if (r.already) {
        wx.showToast({ title: '你已投递过该岗位', icon: 'none' });
      } else {
        wx.hideLoading();
        await new Promise((resolve) => {
          wx.showModal({
            title: '报名成功',
            content: '请前往我的信息->我的工单查看订单',
            showCancel: false,
            confirmText: '我知道了',
            success: () => resolve(),
            fail: () => resolve()
          });
        });
      }
    } catch (e) {
      const msg = (e && e.message) || '报名失败';
      if (msg.indexOf('工分不足') > -1 && msg.indexOf('押金') > -1) {
        wx.hideLoading();
        const modalRes = await new Promise((resolve) => {
          wx.showModal({
            title: '工分不足',
            content: `${msg}，是否前往充值？`,
            confirmText: '前往充值',
            cancelText: '取消',
            success: resolve,
            fail: () => resolve({ confirm: false, cancel: true })
          });
        });
        if (modalRes.confirm) {
          wx.navigateTo({ url: '/pages/wallet/recharge' });
        }
        return;
      }
      wx.showToast({ title: msg, icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  contactPublisher() {
    const { job } = this.data;
    if (!job || !job.publisherOpenid) {
      wx.showToast({ title: '无法获取发布者信息', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/pages/chat/detail?jobId=${job._id}&peerOpenid=${job.publisherOpenid}`
    });
  }
});
