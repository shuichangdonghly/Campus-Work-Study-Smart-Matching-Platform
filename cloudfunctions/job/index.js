const cloud = require('wx-server-sdk');
const https = require('https');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

async function ensureCollection(name) {
  // 有些情况下集合不会自动创建，这里做一次兜底
  try {
    await db.createCollection(name);
  } catch (e) {
    // 集合可能已存在或创建失败（后续逻辑会兜底报错）
    console.error('ensureCollection createCollection failed:', name, e && (e.errMsg || e.message || e));
  }
}

async function getUser(openid) {
  const r = await db.collection('users').where({ openid }).get();
  return r.data[0] || null;
}

async function getJob(id) {
  const r = await db.collection('jobs').doc(id).get();
  if (!r.data) return null;
  return { ...r.data, _id: r.data._id || id };
}

function asPositiveInt(n) {
  const x = parseInt(n, 10);
  if (Number.isNaN(x) || x < 1) return null;
  return x;
}

function calcPublisherDeposit(totalReward) {
  return Math.ceil(totalReward * 1.5);
}

function calcStudentDeposit(rewardPoints) {
  return Math.ceil(rewardPoints * 0.5);
}

function isRecruitingStatus(status) {
  // 兼容历史数据：旧数据可能使用 approved 表示已审核可招募
  return status === 'open' || status === 'approved' || status === 'ongoing';
}

function assertApprovedPublisher(user) {
  if (!user || user.role !== 'publisher') {
    return { ok: false, err: { code: 403, message: '需要发布方身份' } };
  }
  if (user.verifyStatus !== 'approved') {
    return { ok: false, err: { code: 403, message: '发布方需通过人工审核' } };
  }
  return { ok: true };
}

function assertApprovedStudent(user) {
  if (!user || user.role !== 'student') {
    return { ok: false, err: { code: 403, message: '需要学生身份' } };
  }
  if (user.verifyStatus !== 'approved') {
    return { ok: false, err: { code: 403, message: '学生需通过人工审核' } };
  }
  return { ok: true };
}

function assertAdmin(user) {
  if (!user || user.role !== 'admin') {
    return { ok: false, err: { code: 403, message: '需要管理员权限' } };
  }
  return { ok: true };
}

/** 管理员订单列表/详情统一四态（与库内 work_orders.status 解耦展示） */
function deriveAdminOrderPhase(order) {
  if (!order) return { key: 'done', label: '已完成' };
  const st = order.status;
  if (st === 'publisher_cancelled' || st === 'admin_cancelled') {
    return { key: 'done', label: '已取消' };
  }
  if (st === 'completed' || st === 'closed') {
    return { key: 'done', label: '已完成' };
  }
  if (st === 'pending_settlement' || st === 'submitted') {
    return { key: 'settling', label: '结算中' };
  }
  if (st === 'ongoing') {
    if (order.signTime) return { key: 'progress', label: '进行中' };
    return { key: 'recruiting', label: '招募中' };
  }
  return { key: 'recruiting', label: '招募中' };
}

function adminPhaseFilterMatches(phaseKey, filter) {
  const f = String(filter || 'all').trim();
  if (!f || f === 'all') return true;
  if (f === 'recruiting') return phaseKey === 'recruiting';
  if (f === 'in_progress') return phaseKey === 'progress';
  if (f === 'settling') return phaseKey === 'settling';
  if (f === 'done') return phaseKey === 'done';
  return true;
}

function deriveAdminPhaseFromJob(job, relatedOrders) {
  if (!job) return { key: 'done', label: '已完成' };
  const st = String(job.status || '').trim().toLowerCase();
  const orders = Array.isArray(relatedOrders) ? relatedOrders : [];

  if (['pending_review', 'open', 'approved'].includes(st)) {
    return { key: 'recruiting', label: '招募中' };
  }
  if (st === 'ongoing') {
    const hasSettlingOrder = orders.some((o) => ['pending_settlement', 'submitted'].includes(String(o.status || '').trim()));
    if (hasSettlingOrder) return { key: 'settling', label: '结算中' };
    return { key: 'progress', label: '进行中' };
  }
  if (['pending_settlement', 'submitted', 'settling'].includes(st)) {
    return { key: 'settling', label: '结算中' };
  }
  if (['closed', 'completed', 'rejected', 'publisher_cancelled', 'admin_cancelled'].includes(st)) {
    return { key: 'done', label: '已完成' };
  }
  return { key: 'done', label: '已完成' };
}

function disputeTypeLabel(type) {
  if (type === 'no_show') return '发布方·投诉爽约';
  if (type === 'non_payment') return '兼职方·投诉拒不付薪';
  if (type === 'issue_by_student') return '兼职方·其他问题投诉';
  if (type === 'issue_by_publisher') return '发布方·其他问题投诉';
  return '投诉';
}

function disputeStatusLabel(s, resolveResult) {
  if (s === 'pending') return '待处理';
  if (s === 'rejected' || resolveResult === 'rejected') return '已驳回';
  if (s === 'approved' || s === 'resolved' || resolveResult === 'approved') return '已完成';
  return s || '—';
}

const JOB_STATUS_TEXT = {
  pending_review: '待审核',
  open: '招募中',
  approved: '招募中',
  ongoing: '进行中',
  closed: '已结束',
  rejected: '已拒绝',
  publisher_cancelled: '发布者已下架',
  admin_cancelled: '管理员取消订单'
};

const ORDER_STATUS_TRANSITIONS = {
  ongoing: ['pending_settlement', 'submitted', 'completed', 'closed', 'publisher_cancelled', 'admin_cancelled'],
  pending_settlement: ['completed', 'closed', 'publisher_cancelled', 'admin_cancelled'],
  submitted: ['pending_settlement', 'completed', 'closed', 'publisher_cancelled', 'admin_cancelled']
};

const JOB_STATUS_TRANSITIONS = {
  pending_review: ['open', 'rejected'],
  open: ['ongoing', 'closed', 'publisher_cancelled', 'admin_cancelled'],
  approved: ['ongoing', 'closed', 'publisher_cancelled', 'admin_cancelled'],
  ongoing: ['closed', 'publisher_cancelled', 'admin_cancelled']
};

const ACTIVE_ORDER_STATUSES = ['ongoing', 'pending_settlement', 'submitted'];

function canTransitionOrderStatus(fromStatus, toStatus) {
  if (fromStatus === toStatus) return true;
  const allowed = ORDER_STATUS_TRANSITIONS[fromStatus] || [];
  return allowed.includes(toStatus);
}

function canTransitionJobStatus(fromStatus, toStatus) {
  if (fromStatus === toStatus) return true;
  const allowed = JOB_STATUS_TRANSITIONS[fromStatus] || [];
  return allowed.includes(toStatus);
}

function deriveJobDisplayStatus(job, orders) {
  const baseStatus = job.status;
  if (
    baseStatus === 'pending_review' ||
    baseStatus === 'rejected' ||
    baseStatus === 'closed' ||
    baseStatus === 'publisher_cancelled' ||
    baseStatus === 'admin_cancelled'
  ) {
    return baseStatus;
  }

  if (!orders || !orders.length) {
    return baseStatus;
  }

  const hasActiveOrder = orders.some((o) => ['ongoing', 'pending_settlement', 'submitted'].includes(o.status));
  if (hasActiveOrder) return 'ongoing';

  const completedCount = orders.filter((o) => o.status === 'completed').length;
  if (completedCount >= (job.needCount || 1)) return 'closed';
  if (completedCount > 0) return 'ongoing';
  return baseStatus;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeLngLatPair(input) {
  if (!input) return null;
  let lng = null;
  let lat = null;
  if (Array.isArray(input) && input.length >= 2) {
    lng = toNumber(input[0]);
    lat = toNumber(input[1]);
  } else if (typeof input === 'object') {
    lng = toNumber(input.lng != null ? input.lng : input.longitude);
    lat = toNumber(input.lat != null ? input.lat : input.latitude);
  }
  if (lng == null || lat == null) return null;
  return { lng, lat };
}

function buildJobLocation(job) {
  return (
    normalizeLngLatPair(job.locationGeo) ||
    normalizeLngLatPair({ lng: job.locationLng, lat: job.locationLat }) ||
    normalizeLngLatPair(job.location)
  );
}

async function getTempFileUrlMap(fileIds) {
  const ids = Array.from(new Set((fileIds || []).filter(Boolean)));
  if (!ids.length) return {};
  try {
    const res = await cloud.getTempFileURL({ fileList: ids });
    const list = (res && res.fileList) || [];
    const map = {};
    for (const item of list) {
      if (!item || !item.fileID) continue;
      map[item.fileID] = item.tempFileURL || '';
    }
    return map;
  } catch (e) {
    console.error('getTempFileUrlMap failed', e);
    return {};
  }
}

async function cancelJobTradesByRole(job, operatorOpenid, role, reason) {
  const ordersRes = await db
    .collection('work_orders')
    .where({
      jobId: job._id,
      status: _.in(ACTIVE_ORDER_STATUSES)
    })
    .get();
  const activeOrders = ordersRes.data || [];
  let compensationTotal = 0;
  let studentRefundTotal = 0;

  for (const order of activeOrders) {
    const studentDeposit = asPositiveInt(order.studentDeposit) || 0;
    const rewardPoints = asPositiveInt(order.rewardPoints) || 0;
    const compensation = role === 'publisher' ? Math.ceil(rewardPoints * 0.05) : 0;
    compensationTotal += compensation;
    studentRefundTotal += studentDeposit;

    await db
      .collection('users')
      .where({ openid: order.studentOpenid })
      .update({
        data: {
          pointsBalance: _.inc(studentDeposit + compensation),
          updateTime: db.serverDate()
        }
      });

    await db.collection('work_orders').doc(order._id).update({
      data: {
        status: role === 'publisher' ? 'publisher_cancelled' : 'admin_cancelled',
        cancelReason: reason || (role === 'publisher' ? '发布者下架兼职' : '管理员取消交易'),
        cancelByRole: role,
        cancelByOpenid: operatorOpenid,
        cancelCompensation: compensation,
        studentDepositReturned: true,
        publisherDepositSettled: true,
        updateTime: db.serverDate()
      }
    });
  }

  const publisherDepositRemaining = asPositiveInt(job.publisherDepositRemaining) || 0;
  const compensationDeduct = Math.min(publisherDepositRemaining, compensationTotal);
  const publisherRefund = Math.max(0, publisherDepositRemaining - compensationDeduct);
  if (publisherRefund > 0) {
    await db
      .collection('users')
      .where({ openid: job.publisherOpenid })
      .update({
        data: {
          pointsBalance: _.inc(publisherRefund),
          updateTime: db.serverDate()
        }
      });
  }

  await db.collection('jobs').doc(job._id).update({
    data: {
      status: role === 'publisher' ? 'publisher_cancelled' : 'admin_cancelled',
      publisherDepositRemaining: 0,
      escrowPoints: 0,
      cancelReason: reason || (role === 'publisher' ? '发布者下架兼职' : '管理员取消交易'),
      cancelByRole: role,
      cancelByOpenid: operatorOpenid,
      cancelTime: db.serverDate(),
      updateTime: db.serverDate()
    }
  });

  await db
    .collection('applications')
    .where({ jobId: job._id, status: 'applied' })
    .update({
      data: {
        status: 'rejected',
        updateTime: db.serverDate()
      }
    });

  return {
    cancelledOrderCount: activeOrders.length,
    compensationTotal,
    studentRefundTotal,
    publisherRefund
  };
}

function normalizeTagsList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((x) => String(x || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(/[，,、|/]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function normalizeTimeSlots(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((x) => String(x || '').trim())
      .filter(Boolean);
  }
  return String(value || '')
    .split(/[，,、|/]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function haversineDistanceKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  const y = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return R * y;
}

function requestTencentDistanceKm(from, to, mapKey) {
  return new Promise((resolve) => {
    if (!mapKey) return resolve(null);
    const fromStr = `${from.lat},${from.lng}`;
    const toStr = `${to.lat},${to.lng}`;
    const path = `/ws/distance/v1/matrix?mode=driving&from=${encodeURIComponent(
      fromStr
    )}&to=${encodeURIComponent(toStr)}&key=${encodeURIComponent(mapKey)}`;
    const req = https.request(
      {
        hostname: 'apis.map.qq.com',
        method: 'GET',
        path,
        timeout: 2000
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            const json = JSON.parse(body || '{}');
            const distanceMeter =
              json &&
              json.result &&
              json.result.rows &&
              json.result.rows[0] &&
              json.result.rows[0].elements &&
              json.result.rows[0].elements[0] &&
              json.result.rows[0].elements[0].distance;
            const km = toNumber(distanceMeter);
            if (km == null) return resolve(null);
            resolve(km / 1000);
          } catch (e) {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      try {
        req.destroy();
      } catch (e) {}
      resolve(null);
    });
    req.end();
  });
}

async function calcDistanceKm(userLoc, jobLoc, useThirdParty) {
  if (!userLoc || !jobLoc) return null;
  if (useThirdParty) {
    const mapKey = process.env.TENCENT_MAP_KEY || '';
    const thirdPartyKm = await requestTencentDistanceKm(userLoc, jobLoc, mapKey);
    if (thirdPartyKm != null) return thirdPartyKm;
  }
  return haversineDistanceKm(userLoc, jobLoc);
}

function calcDistanceScore(distanceKm) {
  if (distanceKm == null) return 40;
  if (distanceKm <= 1) return 100;
  if (distanceKm >= 25) return 0;
  return Math.max(0, Math.round(100 - ((distanceKm - 1) / 24) * 100));
}

function calcSalaryScore(jobSalary, expectedSalary) {
  const js = toNumber(jobSalary);
  const es = toNumber(expectedSalary);
  if (js == null && es == null) return 60;
  if (js != null && (es == null || es <= 0)) return 85;
  if (js == null || es == null || es <= 0) return 50;
  if (js >= es) {
    const bonus = Math.min(20, Math.round(((js - es) / Math.max(es, 1)) * 20));
    return Math.min(100, 85 + bonus);
  }
  return Math.max(0, Math.round((js / es) * 85));
}

function calcTagScore(userTags, jobTags) {
  const u = normalizeTagsList(userTags);
  const j = new Set(normalizeTagsList(jobTags));
  if (!u.length && j.size === 0) return 60;
  if (!u.length) return 50;
  let hit = 0;
  for (const t of u) {
    if (j.has(t)) hit += 1;
  }
  return Math.round((hit / u.length) * 100);
}

function calcTimeScore(userSlots, jobSlots) {
  const u = normalizeTimeSlots(userSlots);
  const j = new Set(normalizeTimeSlots(jobSlots));
  if (!u.length && j.size === 0) return 60;
  if (!u.length || !j.size) return 40;
  let hit = 0;
  for (const t of u) {
    if (j.has(t)) hit += 1;
  }
  return Math.round((hit / Math.max(u.length, 1)) * 100);
}

async function adjustUserCreditScore(openid, delta, reason, orderId, operatorOpenid) {
  const u = await getUser(openid);
  if (!u) return 0;
  const current = parseInt(u.creditScore || 0, 10) || 0;
  const next = Math.max(0, current + delta);
  await db
    .collection('users')
    .where({ openid })
    .update({
      data: {
        creditScore: next,
        updateTime: db.serverDate()
      }
    });
  await db.collection('credit_logs').add({
    data: {
      openid,
      orderId,
      delta,
      reason,
      operatorOpenid,
      beforeScore: current,
      afterScore: next,
      createTime: db.serverDate()
    }
  });
  return next;
}

async function performOrderCompletion(orderId, operatorOpenid) {
  const od = await db.collection('work_orders').doc(orderId).get();
  const order = od.data;
  if (!order) return { code: 404, message: '订单不存在' };

  const job = await getJob(order.jobId);
  if (!job) return { code: 404, message: '工作不存在' };

  if (!canTransitionOrderStatus(order.status, 'completed')) {
    return { code: 400, message: `仅待交易订单可确认，当前为：${order.status}` };
  }

  const reward = asPositiveInt(order.rewardPoints);
  if (!reward) return { code: 400, message: '订单工分异常' };
  const studentDeposit = asPositiveInt(order.studentDeposit);
  const publisherPerOrderDeposit = asPositiveInt(order.publisherPerOrderDeposit);
  if (!studentDeposit || !publisherPerOrderDeposit) {
    return { code: 400, message: '订单押金信息异常' };
  }
  const publisherReturn = publisherPerOrderDeposit - reward;
  if (publisherReturn < 0) return { code: 400, message: '发布方押金配置异常' };
  if ((job.escrowPoints || 0) < reward || (job.publisherDepositRemaining || 0) < publisherPerOrderDeposit) {
    return { code: 400, message: '岗位押金余额不足，请联系管理员' };
  }

  await db.collection('work_orders').doc(orderId).update({
    data: {
      status: 'completed',
      studentDepositReturned: true,
      publisherDepositSettled: true,
      updateTime: db.serverDate()
    }
  });

  await db
    .collection('users')
    .where({ openid: order.studentOpenid })
    .update({
      data: {
        pointsBalance: _.inc(reward + studentDeposit),
        updateTime: db.serverDate()
      }
    });

  await db
    .collection('users')
    .where({ openid: order.publisherOpenid })
    .update({
      data: {
        pointsBalance: _.inc(publisherReturn),
        updateTime: db.serverDate()
      }
    });
  await adjustUserCreditScore(order.studentOpenid, 2, 'order_completed_base', orderId, operatorOpenid);

  const newFilled = (job.filledCount || 0) + 1;
  const newEscrow = (job.escrowPoints || 0) - reward;
  const newPublisherDepositRemaining = (job.publisherDepositRemaining || 0) - publisherPerOrderDeposit;
  const jobPatch = {
    filledCount: newFilled,
    escrowPoints: newEscrow,
    publisherDepositRemaining: newPublisherDepositRemaining,
    updateTime: db.serverDate()
  };
  if (newFilled >= job.needCount) {
    if (!canTransitionJobStatus(job.status, 'closed')) {
      return { code: 400, message: `工作状态不允许 ${job.status} -> closed` };
    }
    jobPatch.status = 'closed';
  }
  await db.collection('jobs').doc(job._id).update({ data: jobPatch });

  return {
    code: 0,
    rewardPaid: reward,
    publisherDepositUsed: publisherPerOrderDeposit,
    publisherDepositRefund: publisherReturn,
    message: `已向兼职者发放 ${reward} 工分（从押金中扣除）`
  };
}

async function performNoShowSettlement(orderId, operatorOpenid, reason) {
  const od = await db.collection('work_orders').doc(orderId).get();
  const order = od.data;
  if (!order) return { code: 404, message: '订单不存在' };

  const job = await getJob(order.jobId);
  if (!job) return { code: 404, message: '订单关联工作不存在' };

  if (!canTransitionOrderStatus(order.status, 'closed')) {
    return { code: 400, message: `当前状态不可判定爽约：${order.status}` };
  }
  if (order.noShowReported) return { code: 400, message: '该订单已按爽约处理' };
  if (order.signTime) {
    return { code: 400, message: '学生已签到，不能再按爽约执行扣罚' };
  }

  const publisherPerOrderDeposit = asPositiveInt(order.publisherPerOrderDeposit);
  if (!publisherPerOrderDeposit) return { code: 400, message: '订单押金信息异常' };
  if ((job.publisherDepositRemaining || 0) < publisherPerOrderDeposit) {
    return { code: 400, message: '岗位押金余额不足，请联系管理员' };
  }

  await db.collection('work_orders').doc(orderId).update({
    data: {
      status: 'closed',
      noShowReported: true,
      studentDepositForfeited: true,
      publisherDepositSettled: true,
      noShowReason: reason || '未按约定到岗',
      noShowTime: db.serverDate(),
      updateTime: db.serverDate()
    }
  });
  await db
    .collection('users')
    .where({ openid: order.publisherOpenid })
    .update({
      data: {
        pointsBalance: _.inc(publisherPerOrderDeposit),
        updateTime: db.serverDate()
      }
    });
  await db.collection('jobs').doc(job._id).update({
    data: {
      publisherDepositRemaining: (job.publisherDepositRemaining || 0) - publisherPerOrderDeposit,
      updateTime: db.serverDate()
    }
  });
  await adjustUserCreditScore(order.studentOpenid, -5, 'publisher_no_show_report', orderId, operatorOpenid);
  await db.collection('order_reports').add({
    data: {
      orderId,
      publisherOpenid: order.publisherOpenid,
      studentOpenid: order.studentOpenid,
      reason: reason || '未按约定到岗',
      status: 'accepted',
      createTime: db.serverDate()
    }
  });
  return { code: 0 };
}

async function performManualDisputeSettlement(orderId, settlement, operatorOpenid, reason) {
  const od = await db.collection('work_orders').doc(orderId).get();
  const order = od.data;
  if (!order) return { code: 404, message: '订单不存在' };
  const job = await getJob(order.jobId);
  if (!job) return { code: 404, message: '订单关联工作不存在' };
  if (!canTransitionOrderStatus(order.status, 'closed')) {
    return { code: 400, message: `当前状态不可执行人工结算：${order.status}` };
  }

  const studentDeposit = asPositiveInt(order.studentDeposit) || 0;
  const publisherPerOrderDeposit = asPositiveInt(order.publisherPerOrderDeposit) || 0;
  if (studentDeposit <= 0 || publisherPerOrderDeposit <= 0) {
    return { code: 400, message: '订单押金信息异常，无法人工分配' };
  }
  if (order.publisherDepositSettled) {
    return { code: 400, message: '该订单发布方押金已结算，不能重复分配' };
  }

  const sToStudent = Math.max(0, parseInt(settlement.studentDepositToStudent, 10) || 0);
  const sToPublisher = Math.max(0, parseInt(settlement.studentDepositToPublisher, 10) || 0);
  const pToStudent = Math.max(0, parseInt(settlement.publisherDepositToStudent, 10) || 0);
  const pToPublisher = Math.max(0, parseInt(settlement.publisherDepositToPublisher, 10) || 0);

  if (sToStudent + sToPublisher !== studentDeposit) {
    return { code: 400, message: `学生押金分配总额需等于 ${studentDeposit}` };
  }
  if (pToStudent + pToPublisher !== publisherPerOrderDeposit) {
    return { code: 400, message: `发布押金分配总额需等于 ${publisherPerOrderDeposit}` };
  }

  const studentGain = sToStudent + pToStudent;
  const publisherGain = sToPublisher + pToPublisher;
  if (studentGain > 0) {
    await db
      .collection('users')
      .where({ openid: order.studentOpenid })
      .update({
        data: {
          pointsBalance: _.inc(studentGain),
          updateTime: db.serverDate()
        }
      });
  }
  if (publisherGain > 0) {
    await db
      .collection('users')
      .where({ openid: order.publisherOpenid })
      .update({
        data: {
          pointsBalance: _.inc(publisherGain),
          updateTime: db.serverDate()
        }
      });
  }

  await db.collection('work_orders').doc(orderId).update({
    data: {
      status: 'closed',
      manualDisputeSettled: true,
      studentDepositReturned: sToStudent > 0,
      studentDepositForfeited: sToPublisher > 0,
      publisherDepositSettled: true,
      manualSettlement: {
        studentDeposit,
        publisherPerOrderDeposit,
        studentDepositToStudent: sToStudent,
        studentDepositToPublisher: sToPublisher,
        publisherDepositToStudent: pToStudent,
        publisherDepositToPublisher: pToPublisher,
        studentGain,
        publisherGain,
        reason: String(reason || '').slice(0, 200),
        operatorOpenid
      },
      updateTime: db.serverDate()
    }
  });

  await db.collection('jobs').doc(job._id).update({
    data: {
      publisherDepositRemaining: Math.max(0, (job.publisherDepositRemaining || 0) - publisherPerOrderDeposit),
      updateTime: db.serverDate()
    }
  });

  return {
    code: 0,
    settlementSummary: {
      studentGain,
      publisherGain,
      studentDeposit,
      publisherPerOrderDeposit
    }
  };
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action;

  if (!OPENID) {
    return { code: 1, message: '未登录' };
  }

  await Promise.all([
    ensureCollection('users'),
    ensureCollection('jobs'),
    ensureCollection('applications'),
    ensureCollection('work_orders'),
    ensureCollection('messages'),
    ensureCollection('credit_logs'),
    ensureCollection('order_reports'),
    ensureCollection('disputes')
  ]);

  const me = await getUser(OPENID);
  if (!me) {
    return { code: 2, message: '用户不存在' };
  }

  try {
    if (action === 'createJob') {
      const c = assertApprovedPublisher(me);
      if (!c.ok) return c.err;

      const title = (event.title || '').trim();
      const category = (event.category || '').trim();
      const location = (event.location || '').trim();
      const timeDesc = (event.timeDesc || '').trim();
      const description = (event.description || '').trim();
      const contact = (event.contact || '').trim();
      const locationAddress = (event.locationAddress || location).trim();
      const locationLat = toNumber(event.locationLat);
      const locationLng = toNumber(event.locationLng);
      const rewardPoints = asPositiveInt(event.rewardPoints);
      const needCount = asPositiveInt(event.needCount);

      if (!title || !location || !timeDesc || !description) {
        return { code: 400, message: '请填写标题、地点、时间与工作说明' };
      }
      if (!rewardPoints || !needCount) {
        return { code: 400, message: '工分与人数须为正整数' };
      }
      const totalReward = rewardPoints * needCount;
      const publisherDepositTotal = calcPublisherDeposit(totalReward);
      const myBalance = parseInt(me.pointsBalance || 0, 10) || 0;
      if (myBalance < publisherDepositTotal) {
        return {
          code: 400,
          message: `工分余额不足，发布该兼职需先缴纳押金 ${publisherDepositTotal} 工分（总薪资 ${totalReward} 的150%）`
        };
      }

      await db
        .collection('users')
        .where({ openid: OPENID })
        .update({
          data: {
            pointsBalance: _.inc(-publisherDepositTotal),
            updateTime: db.serverDate()
          }
        });

      const addRes = await db.collection('jobs').add({
        data: {
          publisherOpenid: OPENID,
          title,
          category,
          location,
          locationText: locationAddress || location,
          locationAddress: locationAddress || location,
          locationLat: locationLat != null ? locationLat : null,
          locationLng: locationLng != null ? locationLng : null,
          locationGeo:
            locationLat != null && locationLng != null
              ? { lat: locationLat, lng: locationLng }
              : null,
          timeDesc,
          description,
          contact,
          rewardPoints,
          needCount,
          filledCount: 0,
          status: 'pending_review',
          escrowPoints: totalReward,
          publisherDepositTotal,
          publisherDepositRemaining: publisherDepositTotal,
          studentDepositPerOrder: calcStudentDeposit(rewardPoints),
          rejectReason: '',
          createTime: db.serverDate(),
          updateTime: db.serverDate()
        }
      });

      return { code: 0, jobId: addRes._id };
    }

    if (action === 'listOpenJobs') {
      const r = await db
        .collection('jobs')
        .where({ status: _.in(['open', 'approved', 'ongoing']) })
        .orderBy('createTime', 'desc')
        .limit(50)
        .get();
      const jobs = r.data || [];
      if (!jobs.length) {
        return { code: 0, list: [] };
      }

      const jobIds = jobs.map((j) => j._id).filter(Boolean);
      const orderRes = await db
        .collection('work_orders')
        .where({
          jobId: _.in(jobIds),
          status: _.in(['ongoing', 'pending_settlement', 'submitted'])
        })
        .get();

      const activeOrderCountMap = {};
      for (const order of orderRes.data || []) {
        activeOrderCountMap[order.jobId] = (activeOrderCountMap[order.jobId] || 0) + 1;
      }

      const list = jobs.filter((job) => {
        const needCount = asPositiveInt(job.needCount) || 1;
        const filledCount = asPositiveInt(job.filledCount) || 0;
        const activeCount = activeOrderCountMap[job._id] || 0;
        // 只要总占用名额(已完成+进行中)未满，就继续在大厅展示，支持多人持续招募
        return (filledCount + activeCount) < needCount;
      });

      return { code: 0, list };
    }

    if (action === 'getRecommendedJobs') {
      const stu = assertApprovedStudent(me);
      if (!stu.ok) return stu.err;

      const page = Math.max(1, parseInt(event.page, 10) || 1);
      const pageSize = Math.min(20, Math.max(5, parseInt(event.pageSize, 10) || 10));
      const userLocation = normalizeLngLatPair(event.location || me.location);
      const expectedSalary = toNumber(event.expectedSalary != null ? event.expectedSalary : me.expectedSalary);
      const freeTimeSlots = normalizeTimeSlots(event.freeTimeSlots || me.freeTimeSlots || []);

      const jobsRes = await db
        .collection('jobs')
        .where({ status: _.in(['open', 'approved', 'ongoing']) })
        .orderBy('createTime', 'desc')
        .limit(200)
        .get();
      let jobs = jobsRes.data || [];

      if (jobs.length) {
        const jobIds = jobs.map((j) => j._id).filter(Boolean);
        const activeOrderRes = await db
          .collection('work_orders')
          .where({
            jobId: _.in(jobIds),
            status: _.in(['ongoing', 'pending_settlement', 'submitted'])
          })
          .get();
        const activeOrderCountMap = {};
        for (const order of activeOrderRes.data || []) {
          activeOrderCountMap[order.jobId] = (activeOrderCountMap[order.jobId] || 0) + 1;
        }
        jobs = jobs.filter((job) => {
          const needCount = asPositiveInt(job.needCount) || 1;
          const filledCount = asPositiveInt(job.filledCount) || 0;
          const activeCount = activeOrderCountMap[job._id] || 0;
          return (filledCount + activeCount) < needCount;
        });
      }

      const applicationsRes = await db
        .collection('applications')
        .where({ studentOpenid: OPENID })
        .limit(200)
        .get();
      const appliedJobIdSet = new Set((applicationsRes.data || []).map((a) => a.jobId).filter(Boolean));
      jobs = jobs.filter((j) => !appliedJobIdSet.has(j._id));
      const useThirdPartyDistance = !!process.env.TENCENT_MAP_KEY && jobs.length <= 30;

      const scored = [];
      for (const job of jobs) {
        const jobLoc = buildJobLocation(job);
        const distanceKm = await calcDistanceKm(userLocation, jobLoc, useThirdPartyDistance);
        const distanceScore = calcDistanceScore(distanceKm);
        const salaryScore = calcSalaryScore(
          job.salary != null ? job.salary : job.rewardPoints,
          expectedSalary
        );
        const timeScore = calcTimeScore(freeTimeSlots, job.workTime || job.timeDesc || []);

        const totalScore = Math.round(
          distanceScore * 0.5 + salaryScore * 0.3 + timeScore * 0.2
        );

        scored.push({
          ...job,
          matchScore: totalScore,
          distanceKm: distanceKm != null ? Number(distanceKm.toFixed(2)) : null,
          scoreBreakdown: {
            distanceScore,
            salaryScore,
            timeScore
          }
        });
      }

      scored.sort((a, b) => b.matchScore - a.matchScore);
      const total = scored.length;
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      const list = scored.slice(start, end);

      return {
        code: 0,
        data: {
          list,
          page,
          pageSize,
          total,
          hasMore: end < total
        }
      };
    }

    if (action === 'getJob') {
      const jobId = event.jobId;
      if (!jobId) return { code: 400, message: '缺少 jobId' };
      const job = await getJob(jobId);
      if (!job) return { code: 404, message: '工作不存在' };
      let applied = false;
      if (me.role === 'student') {
        const [applicationRes, orderRes] = await Promise.all([
          db
            .collection('applications')
            .where({ jobId, studentOpenid: OPENID })
            .limit(1)
            .get(),
          db
            .collection('work_orders')
            .where({
              jobId,
              studentOpenid: OPENID,
              status: _.in(['ongoing', 'pending_settlement', 'submitted', 'completed'])
            })
            .limit(1)
            .get()
        ]);
        applied = (applicationRes.data && applicationRes.data.length > 0)
          || (orderRes.data && orderRes.data.length > 0);
      }
      return { code: 0, job, applied };
    }

    if (action === 'myPublishedJobs') {
      const c = assertApprovedPublisher(me);
      if (!c.ok) return c.err;

      const r = await db
        .collection('jobs')
        .where({ publisherOpenid: OPENID })
        .orderBy('createTime', 'desc')
        .limit(50)
        .get();
      const ordersRes = await db
        .collection('work_orders')
        .where({ publisherOpenid: OPENID })
        .get();
      const orderMap = {};
      for (const order of ordersRes.data) {
        if (!orderMap[order.jobId]) orderMap[order.jobId] = [];
        orderMap[order.jobId].push(order);
      }
      const list = r.data.map((job) => {
        const displayStatus = deriveJobDisplayStatus(job, orderMap[job._id] || []);
        return {
          ...job,
          displayStatus,
          displayStatusText: JOB_STATUS_TEXT[displayStatus] || displayStatus || '未知状态'
        };
      });
      return { code: 0, list };
    }

    if (action === 'publisherCancelJob') {
      const c = assertApprovedPublisher(me);
      if (!c.ok) return c.err;
      const jobId = String(event.jobId || '').trim();
      const reason = String(event.reason || '').trim().slice(0, 200);
      if (!jobId) return { code: 400, message: '缺少 jobId' };
      const job = await getJob(jobId);
      if (!job || job.publisherOpenid !== OPENID) {
        return { code: 403, message: '无权操作该岗位' };
      }
      if (['closed', 'rejected', 'pending_review', 'publisher_cancelled', 'admin_cancelled'].includes(job.status)) {
        return { code: 400, message: '当前状态不可下架' };
      }
      const result = await cancelJobTradesByRole(job, OPENID, 'publisher', reason);
      return {
        code: 0,
        ...result,
        message:
          result.cancelledOrderCount > 0
            ? `已下架，补偿 ${result.compensationTotal} 工分，退还剩余押金 ${result.publisherRefund} 工分`
            : `已下架并退还押金 ${result.publisherRefund} 工分`
      };
    }

    if (action === 'adminCancelJobTrade') {
      const a = assertAdmin(me);
      if (!a.ok) return a.err;
      const jobId = String(event.jobId || '').trim();
      const reason = String(event.reason || '').trim().slice(0, 200);
      if (!jobId) return { code: 400, message: '缺少 jobId' };
      const job = await getJob(jobId);
      if (!job) return { code: 404, message: '岗位不存在' };
      if (job.status === 'admin_cancelled') {
        return { code: 0, message: '该岗位已被管理员取消' };
      }
      const result = await cancelJobTradesByRole(job, OPENID, 'admin', reason || '管理员取消交易');
      return {
        code: 0,
        ...result,
        message: `已取消交易并退还双方押金，发布方退回 ${result.publisherRefund} 工分`
      };
    }

    if (action === 'applyJob') {
      const stu = assertApprovedStudent(me);
      if (!stu.ok) return stu.err;

      const jobId = event.jobId;
      if (!jobId) return { code: 400, message: '缺少 jobId' };
      const job = await getJob(jobId);
      if (!job || !isRecruitingStatus(job.status)) {
        return { code: 400, message: '该工作不可报名' };
      }
      const activeOrders = await db
        .collection('work_orders')
        .where({
          jobId,
          status: _.in(['ongoing', 'pending_settlement', 'submitted'])
        })
        .count();
      const filledCount = asPositiveInt(job.filledCount) || 0;
      const needCount = asPositiveInt(job.needCount) || 1;
      if ((filledCount + activeOrders.total) >= needCount) {
        return { code: 400, message: '该工作名额已满' };
      }

      const dup = await db
        .collection('applications')
        .where({ jobId, studentOpenid: OPENID })
        .get();
      if (dup.data.length > 0) {
        return { code: 0, applicationId: dup.data[0]._id, already: true };
      }

      const existingOrder = await db
        .collection('work_orders')
        .where({
          jobId,
          studentOpenid: OPENID,
          status: _.in(['ongoing', 'pending_settlement', 'submitted', 'completed'])
        })
        .get();
      if (existingOrder.data.length > 0) {
        return { code: 400, message: '你已参与过该订单，不能重复投递' };
      }

      const ar = await db.collection('applications').add({
        data: {
          jobId,
          studentOpenid: OPENID,
          status: 'applied',
          createTime: db.serverDate()
        }
      });
      return { code: 0, applicationId: ar._id };
    }

    if (action === 'listApplications') {
      const c = assertApprovedPublisher(me);
      if (!c.ok) return c.err;

      const jobId = event.jobId;
      if (!jobId) return { code: 400, message: '缺少 jobId' };
      const job = await getJob(jobId);
      if (!job || job.publisherOpenid !== OPENID) {
        return { code: 403, message: '无权查看' };
      }

      const apps = await db.collection('applications').where({ jobId }).get();
      const openids = [...new Set(apps.data.map((a) => a.studentOpenid))];
      const userMap = {};
      for (const oid of openids) {
        const u = await getUser(oid);
        if (u) userMap[oid] = u;
      }
      const list = apps.data.map((a) => ({
        ...a,
        student: userMap[a.studentOpenid] || null
      }));
      return { code: 0, list };
    }

    if (action === 'acceptApplication') {
      const c = assertApprovedPublisher(me);
      if (!c.ok) return c.err;

      const applicationId = event.applicationId;
      if (!applicationId) return { code: 400, message: '缺少 applicationId' };

      const appDoc = await db.collection('applications').doc(applicationId).get();
      const app = appDoc.data;
      if (!app) {
        return { code: 404, message: '申请不存在' };
      }
      if (app.status !== 'applied') {
        return { code: 400, message: '申请状态不可录用' };
      }

      const job = await getJob(app.jobId);
      if (!job || job.publisherOpenid !== OPENID) {
        return { code: 403, message: '无权操作' };
      }
      if (!isRecruitingStatus(job.status)) {
        return { code: 400, message: '工作未在招募中' };
      }

      const activeOrders = await db
        .collection('work_orders')
        .where({
          jobId: app.jobId,
          status: _.in(['ongoing', 'pending_settlement', 'submitted'])
        })
        .count();
      const filledCount = asPositiveInt(job.filledCount) || 0;
      const needCount = asPositiveInt(job.needCount) || 1;
      if ((filledCount + activeOrders.total) >= needCount) {
        return { code: 400, message: '录用人数已满' };
      }

      const student = await getUser(app.studentOpenid);
      if (!student) return { code: 404, message: '学生不存在' };
      const studentDeposit = asPositiveInt(job.studentDepositPerOrder || calcStudentDeposit(job.rewardPoints));
      const studentBalance = parseInt(student.pointsBalance || 0, 10) || 0;
      if (studentBalance < studentDeposit) {
        return { code: 400, message: `该学生工分不足，接单需押金 ${studentDeposit}` };
      }

      await db.collection('applications').doc(applicationId).update({
        data: { status: 'accepted', updateTime: db.serverDate() }
      });

      await db
        .collection('users')
        .where({ openid: app.studentOpenid })
        .update({
          data: {
            pointsBalance: _.inc(-studentDeposit),
            updateTime: db.serverDate()
          }
        });

      const wr = await db.collection('work_orders').add({
        data: {
          jobId: app.jobId,
          studentOpenid: app.studentOpenid,
          publisherOpenid: OPENID,
          rewardPoints: job.rewardPoints,
          studentDeposit,
          publisherPerOrderDeposit: Math.ceil(job.rewardPoints * 1.5),
          status: 'ongoing',
          submitPhotoFileId: '',
          submitText: '',
          createTime: db.serverDate(),
          updateTime: db.serverDate()
        }
      });

      if (!canTransitionJobStatus(job.status, 'ongoing')) {
        return { code: 400, message: `工作状态不允许 ${job.status} -> ongoing` };
      }
      await db.collection('jobs').doc(job._id).update({
        data: {
          status: 'ongoing',
          updateTime: db.serverDate()
        }
      });

      const afterActive = await db
        .collection('work_orders')
        .where({
          jobId: app.jobId,
          status: _.in(['ongoing', 'pending_settlement', 'submitted'])
        })
        .count();

      if ((filledCount + afterActive.total) >= needCount) {
        const rest = await db
          .collection('applications')
          .where({ jobId: app.jobId, status: 'applied' })
          .get();
        for (const o of rest.data) {
          await db.collection('applications').doc(o._id).update({
            data: { status: 'rejected', updateTime: db.serverDate() }
          });
        }
      }

      return { code: 0, orderId: wr._id };
    }

    if (action === 'myWorkOrders') {
      const stu = assertApprovedStudent(me);
      if (!stu.ok) return stu.err;

      const r = await db
        .collection('work_orders')
        .where({ studentOpenid: OPENID })
        .orderBy('createTime', 'desc')
        .limit(50)
        .get();
      const jobs = {};
      for (const o of r.data) {
        if (!jobs[o.jobId]) {
          jobs[o.jobId] = await getJob(o.jobId);
        }
      }
      const list = r.data.map((o) => ({ ...o, job: jobs[o.jobId] || null }));
      return { code: 0, list };
    }

    if (action === 'publisherWorkOrders') {
      const c = assertApprovedPublisher(me);
      if (!c.ok) return c.err;

      const r = await db
        .collection('work_orders')
        .where({ publisherOpenid: OPENID })
        .orderBy('createTime', 'desc')
        .limit(50)
        .get();
      const jobs = {};
      const students = {};
      for (const o of r.data) {
        if (!jobs[o.jobId]) jobs[o.jobId] = await getJob(o.jobId);
        if (!students[o.studentOpenid]) {
          students[o.studentOpenid] = await getUser(o.studentOpenid);
        }
      }
      const list = r.data.map((o) => ({
        ...o,
        job: jobs[o.jobId] || null,
        student: students[o.studentOpenid] || null
      }));
      const fileUrlMap = await getTempFileUrlMap(list.map((o) => o.submitPhotoFileId));
      for (const item of list) {
        item.submitPhotoUrl = fileUrlMap[item.submitPhotoFileId] || '';
      }
      return { code: 0, list };
    }

    if (action === 'submitWork') {
      const stu = assertApprovedStudent(me);
      if (!stu.ok) return stu.err;

      const orderId = event.orderId;
      const photoFileId = (event.photoFileId || '').trim();
      const text = (event.text || '').trim();
      if (!orderId) return { code: 400, message: '缺少 orderId' };
      if (!photoFileId) return { code: 400, message: '请上传完工照片' };

      const od = await db.collection('work_orders').doc(orderId).get();
      const order = od.data;
      if (!order || order.studentOpenid !== OPENID) {
        return { code: 403, message: '订单不存在' };
      }
      if (!canTransitionOrderStatus(order.status, 'pending_settlement')) {
        return { code: 400, message: `当前状态不可提交：${order.status}` };
      }

      await db.collection('work_orders').doc(orderId).update({
        data: {
          submitPhotoFileId: photoFileId,
          submitText: text,
          submitTime: db.serverDate(),
          status: 'pending_settlement',
          updateTime: db.serverDate()
        }
      });
      return { code: 0 };
    }

    if (action === 'confirmWork') {
      const orderId = event.orderId;
      if (!orderId) return { code: 400, message: '缺少 orderId' };

      const od = await db.collection('work_orders').doc(orderId).get();
      const order = od.data;
      if (!order) return { code: 404, message: '订单不存在' };

      const job = await getJob(order.jobId);
      if (!job) return { code: 404, message: '工作不存在' };

      const isPublisher = me.role === 'publisher' && job.publisherOpenid === OPENID;
      const isAdminUser = me.role === 'admin';
      if (!isPublisher && !isAdminUser) {
        return { code: 403, message: '无权确认完工' };
      }

      const pendingDispute = await db
        .collection('disputes')
        .where({ orderId, status: 'pending' })
        .count();
      if (pendingDispute.total > 0) {
        return { code: 400, message: '该订单有待管理员处理的投诉，暂不可确认完工' };
      }

      return performOrderCompletion(orderId, OPENID);
    }

    if (action === 'reportNoShow') {
      const orderId = event.orderId;
      const reason = String(event.reason || '').trim().slice(0, 200);
      if (!orderId) return { code: 400, message: '缺少 orderId' };

      const od = await db.collection('work_orders').doc(orderId).get();
      const order = od.data;
      if (!order) return { code: 404, message: '订单不存在' };
      if (!(me.role === 'publisher' && order.publisherOpenid === OPENID)) {
        return { code: 403, message: '仅发布方可投诉爽约' };
      }
      const job = await getJob(order.jobId);
      if (!job) return { code: 404, message: '订单关联工作不存在' };

      if (order.signTime) {
        return { code: 400, message: '学生已签到，请通过其他沟通渠道处理纠纷' };
      }
      if (!canTransitionOrderStatus(order.status, 'closed')) {
        return { code: 400, message: `当前状态不可发起爽约投诉：${order.status}` };
      }
      if (order.noShowReported) return { code: 400, message: '该订单已按爽约处理' };

      const pendingDup = await db.collection('disputes').where({ orderId, status: 'pending' }).count();
      if (pendingDup.total > 0) {
        return { code: 400, message: '该订单已有待审核的投诉' };
      }

      const publisherPerOrderDeposit = asPositiveInt(order.publisherPerOrderDeposit);
      if (!publisherPerOrderDeposit) return { code: 400, message: '订单押金信息异常' };
      if ((job.publisherDepositRemaining || 0) < publisherPerOrderDeposit) {
        return { code: 400, message: '岗位押金余额不足，暂无法发起（请联系管理员）' };
      }

      await db.collection('disputes').add({
        data: {
          orderId,
          jobId: order.jobId,
          type: 'no_show',
          complainantOpenid: OPENID,
          respondentOpenid: order.studentOpenid,
          reason: reason || '未按约定到岗',
          status: 'pending',
          createTime: db.serverDate()
        }
      });

      return { code: 0, message: '已提交管理员审核，处理前请保持沟通' };
    }

    if (action === 'reportMerchantNoPay') {
      const stu = assertApprovedStudent(me);
      if (!stu.ok) return stu.err;

      const orderId = event.orderId;
      const reason = String(event.reason || '').trim().slice(0, 200);
      const photoFileId = String(event.photoFileId || '').trim();
      if (!orderId) return { code: 400, message: '缺少 orderId' };

      const od = await db.collection('work_orders').doc(orderId).get();
      const order = od.data;
      if (!order || order.studentOpenid !== OPENID) {
        return { code: 403, message: '无权投诉该订单' };
      }
      if (!['pending_settlement', 'submitted'].includes(order.status)) {
        return { code: 400, message: '仅待商家结算阶段可投诉拒不支付工分' };
      }
      const pendingDup = await db.collection('disputes').where({ orderId, status: 'pending' }).count();
      if (pendingDup.total > 0) {
        return { code: 400, message: '该订单已有待审核的投诉' };
      }

      await db.collection('disputes').add({
        data: {
          orderId,
          jobId: order.jobId,
          type: 'non_payment',
          complainantOpenid: OPENID,
          respondentOpenid: order.publisherOpenid,
          reason: reason || '商家拒不支付工分',
          disputePhotoFileId: photoFileId,
          status: 'pending',
          createTime: db.serverDate()
        }
      });

      return { code: 0, message: '已提交管理员审核' };
    }

    if (action === 'reportOtherDispute') {
      const orderId = event.orderId;
      const reason = String(event.reason || '').trim().slice(0, 500);
      if (!orderId) return { code: 400, message: '缺少 orderId' };
      if (reason.length < 4) return { code: 400, message: '请填写投诉说明（至少4个字）' };

      const od = await db.collection('work_orders').doc(orderId).get();
      const order = od.data;
      if (!order) return { code: 404, message: '订单不存在' };

      const isStudent = me.role === 'student' && order.studentOpenid === OPENID;
      const isPublisher = me.role === 'publisher' && order.publisherOpenid === OPENID;
      if (!isStudent && !isPublisher) {
        return { code: 403, message: '仅订单关联的兼职方或发布方可发起此类投诉' };
      }
      if (!['ongoing', 'pending_settlement', 'submitted'].includes(order.status)) {
        return { code: 400, message: '当前订单状态不可发起投诉' };
      }

      const pendingDup = await db.collection('disputes').where({ orderId, status: 'pending' }).count();
      if (pendingDup.total > 0) {
        return { code: 400, message: '该订单已有待管理员处理的投诉' };
      }

      const type = isStudent ? 'issue_by_student' : 'issue_by_publisher';
      const complainantOpenid = OPENID;
      const respondentOpenid = isStudent ? order.publisherOpenid : order.studentOpenid;

      await db.collection('disputes').add({
        data: {
          orderId,
          jobId: order.jobId,
          type,
          complainantOpenid,
          respondentOpenid,
          reason,
          status: 'pending',
          createTime: db.serverDate()
        }
      });

      return { code: 0, message: '已提交管理员审核' };
    }

    if (action === 'adminListPendingDisputes') {
      const a = assertAdmin(me);
      if (!a.ok) return a.err;

      const r = await db
        .collection('disputes')
        .where({ status: 'pending' })
        .limit(100)
        .get();
      const raw = (r.data || []).slice();
      raw.sort((x, y) => {
        const tx = new Date(x.createTime || 0).getTime();
        const ty = new Date(y.createTime || 0).getTime();
        return ty - tx;
      });
      const sliced = raw.slice(0, 50);
      const list = [];
      for (const d of sliced) {
        const odoc = await db.collection('work_orders').doc(d.orderId).get();
        const ord = odoc.data || null;
        const j = ord ? await getJob(ord.jobId) : null;
        const complainant = await getUser(d.complainantOpenid);
        const respondent = await getUser(d.respondentOpenid);
        const vpC = complainant && complainant.verifyPayload;
        const vpR = respondent && respondent.verifyPayload;
        const typeText = disputeTypeLabel(d.type);
        const submitTextDisplay =
          ord && ord.submitText != null ? String(ord.submitText).trim() : '';
        const phaseShort = ord ? deriveAdminOrderPhase(ord).label : '';
        const studentDeposit = ord ? asPositiveInt(ord.studentDeposit) || 0 : 0;
        const publisherPerOrderDeposit = ord ? asPositiveInt(ord.publisherPerOrderDeposit) || 0 : 0;
        const totalDeposit = studentDeposit + publisherPerOrderDeposit;
        list.push({
          ...d,
          _id: d._id,
          typeText,
          orderSummary: ord ? `订单 ${String(d.orderId).slice(0, 6)}… · ${phaseShort}` : '订单信息缺失',
          submitTextDisplay,
          submitPhotoFileId: (ord && ord.submitPhotoFileId) || '',
          disputePhotoFileId: d.disputePhotoFileId || '',
          studentDeposit,
          publisherPerOrderDeposit,
          totalDeposit,
          jobTitle: (j && j.title) || '—',
          complainantName:
            (complainant && (complainant.nickName || (vpC && vpC.realName))) || '—',
          respondentName:
            (respondent && (respondent.nickName || (vpR && vpR.unitName))) || '—'
        });
      }
      const fileUrlMap = await getTempFileUrlMap([
        ...list.map((item) => item.submitPhotoFileId),
        ...list.map((item) => item.disputePhotoFileId)
      ]);
      for (const item of list) {
        item.submitPhotoUrl = fileUrlMap[item.submitPhotoFileId] || '';
        item.disputePhotoUrl = fileUrlMap[item.disputePhotoFileId] || '';
      }
      return { code: 0, list };
    }

    if (action === 'adminCountPendingDisputes') {
      const a = assertAdmin(me);
      if (!a.ok) return a.err;
      const c = await db.collection('disputes').where({ status: 'pending' }).count();
      return { code: 0, count: c.total || 0 };
    }

    if (action === 'adminResolveDispute') {
      const a = assertAdmin(me);
      if (!a.ok) return a.err;

      const disputeId = event.disputeId;
      const approve = !!event.approve;
      const adminNote = String(event.adminNote || '').trim().slice(0, 200);
      if (!disputeId) return { code: 400, message: '缺少 disputeId' };

      const ddoc = await db.collection('disputes').doc(disputeId).get();
      const d = ddoc.data;
      if (!d || d.status !== 'pending') {
        return { code: 400, message: '投诉状态不可处理' };
      }

      // 管理员可对任意投诉类型直接给出押金分配裁定（特殊情形优先）
      if (approve && event.settlement && typeof event.settlement === 'object') {
        const mr = await performManualDisputeSettlement(d.orderId, event.settlement, OPENID, adminNote || d.reason);
        if (mr.code !== 0) return mr;
        const settlementSummary = mr.settlementSummary || null;
        await db.collection('disputes').doc(disputeId).update({
          data: {
            status: 'resolved',
            resolveResult: 'approved',
            adminNote,
            resolveTime: db.serverDate(),
            resolverOpenid: OPENID,
            manualSettlement: settlementSummary || null
          }
        });
        return {
          code: 0,
          message: settlementSummary
            ? `已按人工分配处理：兼职方 +${settlementSummary.studentGain}，发布方 +${settlementSummary.publisherGain}`
            : '已完成处理'
        };
      }

      if (d.type === 'no_show') {
        if (approve) {
          const pr = await performNoShowSettlement(d.orderId, OPENID, d.reason);
          if (pr.code !== 0) return pr;
        }
        await db.collection('disputes').doc(disputeId).update({
          data: {
            status: 'resolved',
            resolveResult: approve ? 'approved' : 'rejected',
            adminNote,
            resolveTime: db.serverDate(),
            resolverOpenid: OPENID
          }
        });
        return { code: 0, message: '已完成处理' };
      }

      if (d.type === 'non_payment') {
        if (approve) {
          const pr = await performOrderCompletion(d.orderId, OPENID);
          if (pr.code !== 0) return pr;
        }
        await db.collection('disputes').doc(disputeId).update({
          data: {
            status: 'resolved',
            resolveResult: approve ? 'approved' : 'rejected',
            adminNote,
            resolveTime: db.serverDate(),
            resolverOpenid: OPENID
          }
        });
        return { code: 0, message: '已完成处理' };
      }

      if (d.type === 'issue_by_student' || d.type === 'issue_by_publisher') {
        let settlementSummary = null;
        if (approve) {
          const settlement = event.settlement || null;
          if (!settlement || typeof settlement !== 'object') {
            return { code: 400, message: '该类型投诉需管理员填写押金分配方案后再处理' };
          }
          const mr = await performManualDisputeSettlement(d.orderId, settlement, OPENID, adminNote || d.reason);
          if (mr.code !== 0) return mr;
          settlementSummary = mr.settlementSummary || null;
        }
        await db.collection('disputes').doc(disputeId).update({
          data: {
            status: 'resolved',
            resolveResult: approve ? 'approved' : 'rejected',
            adminNote,
            resolveTime: db.serverDate(),
            resolverOpenid: OPENID,
            manualSettlement: settlementSummary || null
          }
        });
        if (approve && settlementSummary) {
          return {
            code: 0,
            message: `已按人工分配处理：兼职方 +${settlementSummary.studentGain}，发布方 +${settlementSummary.publisherGain}`
          };
        }
        return { code: 0, message: '已完成处理' };
      }

      return { code: 400, message: '未知投诉类型' };
    }

    if (action === 'adminGetWorkOrderDetail') {
      const a = assertAdmin(me);
      if (!a.ok) return a.err;

      const orderId = String(event.orderId || '').trim();
      if (!orderId) return { code: 400, message: '缺少 orderId' };

      const odoc = await db.collection('work_orders').doc(orderId).get();
      const order = odoc.data;
      if (!order) return { code: 404, message: '订单不存在' };

      const job = await getJob(order.jobId);
      const student = await getUser(order.studentOpenid);
      const publisher = await getUser(order.publisherOpenid);

      const phase = deriveAdminOrderPhase(order);
      const submitTextDisplay =
        order.submitText != null ? String(order.submitText).trim() : '';

      const dis = await db
        .collection('disputes')
        .where({ orderId })
        .limit(50)
        .get();
      const rawDisputes = (dis.data || []).slice();
      rawDisputes.sort((x, y) => {
        const tx = new Date(x.createTime || 0).getTime();
        const ty = new Date(y.createTime || 0).getTime();
        return ty - tx;
      });
      const disputes = rawDisputes.map((d) => ({
        _id: d._id,
        type: d.type,
        typeText: disputeTypeLabel(d.type),
        reason: d.reason || '',
        status: d.status,
        resolveResult: d.resolveResult || '',
        statusText: disputeStatusLabel(d.status, d.resolveResult),
        adminNote: d.adminNote || '',
        disputePhotoFileId: d.disputePhotoFileId || '',
        complainantOpenid: d.complainantOpenid,
        respondentOpenid: d.respondentOpenid
      }));
      const fileUrlMap = await getTempFileUrlMap([
        order.submitPhotoFileId,
        ...disputes.map((d) => d.disputePhotoFileId)
      ]);

      const studentLabel =
        (student && student.nickName) || (order.studentOpenid ? String(order.studentOpenid).slice(0, 8) : '—');
      const publisherLabel =
        (publisher && publisher.nickName) ||
        (order.publisherOpenid ? String(order.publisherOpenid).slice(0, 8) : '—');

      return {
        code: 0,
        adminPhaseKey: phase.key,
        adminPhaseLabel: phase.label,
        order: {
          _id: orderId,
          status: order.status || '',
          rewardPoints: order.rewardPoints,
          signTime: order.signTime || null,
          submitTime: order.submitTime || null,
          submitText: submitTextDisplay,
          submitPhotoFileId: order.submitPhotoFileId || '',
          submitPhotoUrl: fileUrlMap[order.submitPhotoFileId] || '',
          noShowReason: order.noShowReason || '',
          createTime: order.createTime,
          updateTime: order.updateTime
        },
        job: job
          ? {
              _id: job._id,
              status: job.status || '',
              title: job.title,
              location: job.location || '',
              timeDesc: job.timeDesc || '',
              rewardPoints: job.rewardPoints,
              needCount: job.needCount
            }
          : null,
        studentLabel,
        publisherLabel,
        student,
        publisher,
        disputes: disputes.map((d) => ({
          ...d,
          disputePhotoUrl: fileUrlMap[d.disputePhotoFileId] || ''
        }))
      };
    }

    if (action === 'adminGetJobOrderDetail') {
      const a = assertAdmin(me);
      if (!a.ok) return a.err;
      const jobId = String(event.jobId || '').trim();
      if (!jobId) return { code: 400, message: '缺少 jobId' };

      const job = await getJob(jobId);
      if (!job) return { code: 404, message: '岗位不存在' };

      const ordersRes = await db
        .collection('work_orders')
        .where({ jobId })
        .limit(100)
        .get();
      const relatedOrders = (ordersRes.data || []).slice();
      relatedOrders.sort((x, y) => {
        const tx = new Date(x.updateTime || x.createTime || 0).getTime();
        const ty = new Date(y.updateTime || y.createTime || 0).getTime();
        return ty - tx;
      });
      const order =
        relatedOrders.find((o) => ['ongoing', 'pending_settlement', 'submitted'].includes(String(o.status || '').trim()))
        || relatedOrders[0]
        || null;

      const phase = deriveAdminPhaseFromJob(job, relatedOrders);
      const student = order ? await getUser(order.studentOpenid) : null;
      const publisher = await getUser(job.publisherOpenid);

      const disputesRes = await db
        .collection('disputes')
        .where({ jobId })
        .limit(100)
        .get();
      const rawDisputes = (disputesRes.data || []).slice();
      rawDisputes.sort((x, y) => {
        const tx = new Date(x.createTime || 0).getTime();
        const ty = new Date(y.createTime || 0).getTime();
        return ty - tx;
      });
      const disputes = rawDisputes.map((d) => ({
        _id: d._id,
        type: d.type,
        typeText: disputeTypeLabel(d.type),
        reason: d.reason || '',
        status: d.status,
        resolveResult: d.resolveResult || '',
        statusText: disputeStatusLabel(d.status, d.resolveResult),
        adminNote: d.adminNote || '',
        disputePhotoFileId: d.disputePhotoFileId || '',
        complainantOpenid: d.complainantOpenid,
        respondentOpenid: d.respondentOpenid
      }));
      const fileUrlMap = await getTempFileUrlMap([
        order && order.submitPhotoFileId,
        ...disputes.map((d) => d.disputePhotoFileId)
      ]);
      const studentLabel =
        (student && student.nickName) || (order && order.studentOpenid ? String(order.studentOpenid).slice(0, 8) : '—');
      const publisherLabel =
        (publisher && publisher.nickName) || (job.publisherOpenid ? String(job.publisherOpenid).slice(0, 8) : '—');

      return {
        code: 0,
        adminPhaseKey: phase.key,
        adminPhaseLabel: phase.label,
        order: order
          ? {
              _id: order._id,
              status: order.status || '',
              rewardPoints: order.rewardPoints,
              signTime: order.signTime || null,
              submitTime: order.submitTime || null,
              submitText: order.submitText != null ? String(order.submitText).trim() : '',
              submitPhotoFileId: order.submitPhotoFileId || '',
              submitPhotoUrl: fileUrlMap[order.submitPhotoFileId] || '',
              noShowReason: order.noShowReason || '',
              createTime: order.createTime,
              updateTime: order.updateTime
            }
          : null,
        job: {
          _id: job._id,
          status: job.status || '',
          title: job.title,
          location: job.location || '',
          timeDesc: job.timeDesc || '',
          rewardPoints: job.rewardPoints,
          needCount: job.needCount
        },
        studentLabel,
        publisherLabel,
        student,
        publisher,
        disputes: disputes.map((d) => ({
          ...d,
          disputePhotoUrl: fileUrlMap[d.disputePhotoFileId] || ''
        }))
      };
    }

    if (action === 'adminListAllWorkOrders') {
      const a = assertAdmin(me);
      if (!a.ok) return a.err;

      const phaseFilter = String(event.adminPhase || event.orderStatus || 'all').trim();
      const jobsRes = await db
        .collection('jobs')
        .orderBy('createTime', 'desc')
        .limit(200)
        .get();
      let jobsRows = jobsRes.data || [];
      const jobIdList = jobsRows.map((j) => j._id).filter(Boolean);
      const [ordersRes, pendingDisputesRes] = await Promise.all([
        jobIdList.length
          ? db.collection('work_orders').where({ jobId: _.in(jobIdList) }).limit(500).get()
          : Promise.resolve({ data: [] }),
        db
          .collection('disputes')
          .where({ status: 'pending' })
          .limit(500)
          .get()
      ]);
      const orderRows = ordersRes.data || [];
      const ordersByJobId = {};
      for (const o of orderRows) {
        if (!ordersByJobId[o.jobId]) ordersByJobId[o.jobId] = [];
        ordersByJobId[o.jobId].push(o);
      }

      const pendingDisputes = pendingDisputesRes.data || [];
      const disputeJobIdSet = new Set();
      for (const d of pendingDisputes) {
        if (d.jobId) {
          disputeJobIdSet.add(d.jobId);
          continue;
        }
        const disputeOrder = orderRows.find((o) => o._id === d.orderId);
        if (disputeOrder && disputeOrder.jobId) disputeJobIdSet.add(disputeOrder.jobId);
      }

      if (phaseFilter === 'dispute') {
        jobsRows = jobsRows.filter((j) => disputeJobIdSet.has(j._id));
      }
      jobsRows = jobsRows.filter((job) => {
        const phase = deriveAdminPhaseFromJob(job, ordersByJobId[job._id] || []);
        return adminPhaseFilterMatches(phase.key, phaseFilter);
      });
      const users = {};
      const list = [];
      for (const job of jobsRows) {
        const relatedOrders = ordersByJobId[job._id] || [];
        relatedOrders.sort((x, y) => {
          const tx = new Date(x.updateTime || x.createTime || 0).getTime();
          const ty = new Date(y.updateTime || y.createTime || 0).getTime();
          return ty - tx;
        });
        const representativeOrder =
          relatedOrders.find((o) => ['ongoing', 'pending_settlement', 'submitted'].includes(String(o.status || '').trim()))
          || relatedOrders[0]
          || null;
        if (job.publisherOpenid && !users[job.publisherOpenid]) {
          users[job.publisherOpenid] = await getUser(job.publisherOpenid);
        }
        const phase = deriveAdminPhaseFromJob(job, relatedOrders);
        list.push({
          _id: job._id,
          jobId: job._id,
          orderId: representativeOrder ? representativeOrder._id : '',
          jobTitle: job.title || '—',
          jobStatus: String(job.status || ''),
          rewardPoints: job.rewardPoints,
          adminPhaseKey: phase.key,
          adminPhaseLabel: phase.label,
          studentLabel: '—',
          publisherLabel:
            (users[job.publisherOpenid] && users[job.publisherOpenid].nickName) ||
            (job.publisherOpenid ? String(job.publisherOpenid).slice(0, 8) : '—'),
          hasSubmitProof: false,
          submitTextPreview: ''
        });
      }
      return { code: 0, list, disputeOrderCount: disputeJobIdSet.size };
    }

    if (action === 'adminListAllJobs') {
      const a = assertAdmin(me);
      if (!a.ok) return a.err;

      const statusFilter = String(event.jobStatus || 'all').trim();
      const r = await db
        .collection('jobs')
        .orderBy('createTime', 'desc')
        .limit(80)
        .get();
      let rows = r.data || [];
      if (statusFilter && statusFilter !== 'all') {
        rows = rows.filter((j) => j.status === statusFilter);
      }
      const list = rows.map((j) => ({
        ...j,
        statusText: JOB_STATUS_TEXT[j.status] || j.status || '未知'
      }));
      return { code: 0, list };
    }

    if (action === 'adminListPendingJobs') {
      const a = assertAdmin(me);
      if (!a.ok) return a.err;

      const r = await db
        .collection('jobs')
        .where({ status: 'pending_review' })
        .orderBy('createTime', 'desc')
        .limit(50)
        .get();
      return { code: 0, list: r.data };
    }

    if (action === 'adminApproveJob') {
      const a = assertAdmin(me);
      if (!a.ok) return a.err;

      const jobId = event.jobId;
      if (!jobId) return { code: 400, message: '缺少 jobId' };
      const job = await getJob(jobId);
      if (!job || job.status !== 'pending_review') {
        return { code: 400, message: '工作状态不可审核通过' };
      }
      if (!canTransitionJobStatus(job.status, 'open')) {
        return { code: 400, message: `工作状态不允许 ${job.status} -> open` };
      }

      await db.collection('jobs').doc(jobId).update({
        data: {
          status: 'open',
          auditResult: 'approved',
          auditByOpenid: OPENID,
          auditTime: db.serverDate(),
          updateTime: db.serverDate()
        }
      });

      return {
        code: 0,
        message: `审核通过，已上架（发布押金继续冻结 ${job.publisherDepositRemaining || job.publisherDepositTotal || 0} 工分）`
      };
    }

    if (action === 'adminRejectJob') {
      const a = assertAdmin(me);
      if (!a.ok) return a.err;

      const jobId = event.jobId;
      if (!jobId) return { code: 400, message: '缺少 jobId' };
      const job = await getJob(jobId);
      if (!job) return { code: 404, message: '工作不存在' };
      if (!canTransitionJobStatus(job.status, 'rejected')) {
        return { code: 400, message: `工作状态不允许 ${job.status} -> rejected` };
      }

      // 待审核岗位被驳回：发布押金应全额退回发布方
      const refundableDeposit =
        asPositiveInt(job.publisherDepositRemaining) ||
        asPositiveInt(job.publisherDepositTotal) ||
        0;
      if (refundableDeposit > 0) {
        await db
          .collection('users')
          .where({ openid: job.publisherOpenid })
          .update({
            data: {
              pointsBalance: _.inc(refundableDeposit),
              updateTime: db.serverDate()
            }
          });
      }
      await db.collection('jobs').doc(jobId).update({
        data: {
          status: 'rejected',
          rejectReason: event.reason || '',
          publisherDepositRemaining: 0,
          escrowPoints: 0,
          rejectRefundPoints: refundableDeposit,
          auditResult: 'rejected',
          auditByOpenid: OPENID,
          auditTime: db.serverDate(),
          updateTime: db.serverDate()
        }
      });
      return {
        code: 0,
        refundedDeposit: refundableDeposit,
        message:
          refundableDeposit > 0
            ? `已驳回并退还发布押金 ${refundableDeposit} 工分`
            : '已驳回（该岗位无可退押金）'
      };
    }

    if (action === 'sendMessage') {
      const jobId = event.jobId;
      const toOpenid = event.toOpenid;
      const text = (event.text || '').trim();
      if (!jobId || !toOpenid) return { code: 400, message: '缺少参数' };
      if (!text) return { code: 400, message: '消息不能为空' };
      if (toOpenid === OPENID) return { code: 400, message: '不能给自己发消息' };

      const job = await getJob(jobId);
      if (!job) return { code: 404, message: '岗位不存在' };

      await db.collection('messages').add({
        data: {
          jobId,
          fromOpenid: OPENID,
          toOpenid,
          text,
          createTime: db.serverDate()
        }
      });
      return { code: 0 };
    }

    if (action === 'listMessages') {
      const jobId = event.jobId;
      const peerOpenid = event.peerOpenid;
      if (!jobId || !peerOpenid) return { code: 400, message: '缺少参数' };

      const a = await db
        .collection('messages')
        .where({ jobId, fromOpenid: OPENID, toOpenid: peerOpenid })
        .orderBy('createTime', 'asc')
        .limit(100)
        .get();
      const b = await db
        .collection('messages')
        .where({ jobId, fromOpenid: peerOpenid, toOpenid: OPENID })
        .orderBy('createTime', 'asc')
        .limit(100)
        .get();

      const list = [...a.data, ...b.data].sort((x, y) => {
        const tx = new Date(x.createTime || 0).getTime();
        const ty = new Date(y.createTime || 0).getTime();
        return tx - ty;
      });
      return { code: 0, list };
    }

    if (action === 'listMyChats') {
      const a = await db
        .collection('messages')
        .where({ fromOpenid: OPENID })
        .orderBy('createTime', 'desc')
        .limit(100)
        .get();
      const b = await db
        .collection('messages')
        .where({ toOpenid: OPENID })
        .orderBy('createTime', 'desc')
        .limit(100)
        .get();

      const merged = [...a.data, ...b.data];
      const map = {};
      for (const m of merged) {
        const peerOpenid = m.fromOpenid === OPENID ? m.toOpenid : m.fromOpenid;
        const key = `${m.jobId}__${peerOpenid}`;
        const old = map[key];
        if (!old || new Date(m.createTime || 0).getTime() > new Date(old.createTime || 0).getTime()) {
          map[key] = { ...m, peerOpenid };
        }
      }

      const list = Object.values(map);
      for (const item of list) {
        item.peerUser = await getUser(item.peerOpenid);
        item.job = await getJob(item.jobId);
      }
      list.sort((x, y) => new Date(y.createTime || 0).getTime() - new Date(x.createTime || 0).getTime());
      return { code: 0, list };
    }

    return { code: 404, message: '未知 action' };
  } catch (e) {
    console.error(e);
    return { code: 500, message: String(e) };
  }
};
