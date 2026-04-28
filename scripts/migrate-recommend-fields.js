/**
 * 迁移脚本：为 users / jobs 补齐推荐算法字段。
 * 使用方式（在小程序云函数 Node 环境或本地可访问同环境时执行）：
 * node scripts/migrate-recommend-fields.js
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

async function patchUsers(batchSize = 100) {
  let total = 0;
  let skip = 0;
  while (true) {
    const res = await db.collection('users').skip(skip).limit(batchSize).get();
    const list = res.data || [];
    if (!list.length) break;
    for (const u of list) {
      const updateData = {};
      if (!u.location || typeof u.location !== 'object') {
        updateData.location = null;
      }
      if (u.expectedSalary == null) {
        updateData.expectedSalary = 0;
      }
      if (!Array.isArray(u.preferenceTags)) {
        updateData.preferenceTags = [];
      }
      if (!Array.isArray(u.freeTimeSlots)) {
        updateData.freeTimeSlots = [];
      }
      if (Object.keys(updateData).length) {
        updateData.updateTime = db.serverDate();
        await db.collection('users').doc(u._id).update({ data: updateData });
        total += 1;
      }
    }
    skip += list.length;
  }
  return total;
}

async function patchJobs(batchSize = 100) {
  let total = 0;
  let skip = 0;
  while (true) {
    const res = await db.collection('jobs').skip(skip).limit(batchSize).get();
    const list = res.data || [];
    if (!list.length) break;
    for (const j of list) {
      const updateData = {};
      if (!j.location || typeof j.location !== 'object') {
        updateData.location = null;
      }
      if (j.salary == null) {
        updateData.salary = j.rewardPoints || 0;
      }
      if (!Array.isArray(j.tags)) {
        updateData.tags = [];
      }
      if (!Array.isArray(j.workTime)) {
        updateData.workTime = [];
      }
      if (Object.keys(updateData).length) {
        updateData.updateTime = db.serverDate();
        await db.collection('jobs').doc(j._id).update({ data: updateData });
        total += 1;
      }
    }
    skip += list.length;
  }
  return total;
}

async function main() {
  const usersPatched = await patchUsers();
  const jobsPatched = await patchJobs();
  console.log(JSON.stringify({ usersPatched, jobsPatched }, null, 2));
}

main().catch((err) => {
  console.error('migrate failed', err);
  process.exit(1);
});
