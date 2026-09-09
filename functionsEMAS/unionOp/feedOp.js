// 喂食打卡：分地区、自定义地点、食物类型、统计（喂食/零食已合并，不再区分类别）
const { createInternalCtx } = require('./_helper.js')
const isManagerHandler = require('./isManager.js')

// 喂食类别：meal 喂食 / snack 零食（历史字段，合并后新记录统一为 meal）
const FEED_CATEGORIES = ['meal', 'snack']

// 默认食物类型（管理员可在 setting 集合中自定义）
const DEFAULT_SNACK_TYPES = ['猫粮', '罐头', '猫条', '冻干', '自制猫饭', '其他']

async function checkManager(ctx, openid, req) {
  return await isManagerHandler(createInternalCtx(ctx, {
    openid: openid,
    req: req
  }))
}

// 读取 setting 文档（不存在时返回 null）
async function getSetting(db, id) {
  const { result } = await db.collection('setting').findOne({ _id: id })
  return result || null
}

// 写入 setting 文档（不存在则新建，与 initVaccineTypes 同一模式）
async function saveSetting(db, id, data) {
  const existing = await getSetting(db, id)
  if (!existing) {
    await db.collection('setting').insertOne({ _id: id, ...data })
  } else {
    await db.collection('setting').updateOne({ _id: id }, { $set: data })
  }
}

module.exports = async (ctx) => {
  const openid = ctx.args.openid
  if (!openid) {
    return { msg: '未登录', result: false }
  }
  const operation = ctx.args.operation
  const db = ctx.mpserverless.db

  // ========== 地点与零食类型（所有用户可读） ==========

  // 获取自定义打卡地点列表
  if (operation === 'getLocations') {
    try {
      const setting = await getSetting(db, 'feed_location')
      return { msg: '获取成功', result: true, data: (setting && setting.locations) || [] }
    } catch (error) {
      // 文档不存在时返回空列表
      return { msg: '获取成功', result: true, data: [] }
    }
  }

  // 获取零食类型列表
  if (operation === 'getSnackTypes') {
    try {
      const setting = await getSetting(db, 'feed_snack_type')
      const types = (setting && setting.types) || []
      return { msg: '获取成功', result: true, data: types.length ? types : DEFAULT_SNACK_TYPES }
    } catch (error) {
      return { msg: '获取成功', result: true, data: DEFAULT_SNACK_TYPES }
    }
  }

  // 指定猫的喂食记录（所有人可见，可按类别筛选）
  if (operation === 'listByCat') {
    const cat_id = ctx.args.cat_id
    if (!cat_id) {
      return { msg: '缺少猫咪ID', result: false }
    }
    const query = { cat_id: cat_id }
    if (ctx.args.feed_category && FEED_CATEGORIES.includes(ctx.args.feed_category)) {
      query.feed_category = ctx.args.feed_category
    }
    try {
      const { result: records } = await db.collection('feed_checkin').find(query, {
        sort: { created_at: -1 },
        limit: ctx.args.limit || 50
      })
      return { msg: '获取成功', result: true, data: records }
    } catch (error) {
      return { msg: '获取失败', error, result: false }
    }
  }

  // 指定猫的喂食统计（所有人可见，喂食/零食分开统计）
  if (operation === 'statsByCat') {
    const cat_id = ctx.args.cat_id
    if (!cat_id) {
      return { msg: '缺少猫咪ID', result: false }
    }

    try {
      const now = new Date()
      const fmt = (d) => {
        const m = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        return `${d.getFullYear()}-${m}-${day}`
      }
      const date7 = fmt(new Date(now.getTime() - 7 * 24 * 3600 * 1000))
      const date30 = fmt(new Date(now.getTime() - 30 * 24 * 3600 * 1000))

      // 老数据没有 feed_category 字段，按 meal 计入
      const mealQuery = { cat_id: cat_id, $or: [{ feed_category: 'meal' }, { feed_category: { $exists: false } }] }
      const snackQuery = { cat_id: cat_id, feed_category: 'snack' }

      const [
        { result: mealTotal },
        { result: snackTotal },
        { result: mealLast7d },
        { result: snackLast7d },
        { result: last30d },
        { result: recent },
      ] = await Promise.all([
        db.collection('feed_checkin').count(mealQuery),
        db.collection('feed_checkin').count(snackQuery),
        db.collection('feed_checkin').count({ ...mealQuery, feed_date: { $gte: date7 } }),
        db.collection('feed_checkin').count({ ...snackQuery, feed_date: { $gte: date7 } }),
        db.collection('feed_checkin').count({ cat_id: cat_id, feed_date: { $gte: date30 } }),
        db.collection('feed_checkin').find({ cat_id: cat_id }, { sort: { created_at: -1 }, limit: 1 }),
      ])

      return {
        msg: '获取成功',
        result: true,
        data: {
          total: mealTotal + snackTotal,
          meal_total: mealTotal,
          snack_total: snackTotal,
          meal_last7d: mealLast7d,
          snack_last7d: snackLast7d,
          last7d: mealLast7d + snackLast7d,
          last30d: last30d,
          last_feed: (recent && recent[0]) || null
        }
      }
    } catch (error) {
      return { msg: '获取失败', error, result: false }
    }
  }

  // 今日各猫打卡数汇总（分地区打卡主页用，所有人可读）
  if (operation === 'todayFeedSummary') {
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    try {
      const { result: records } = await db.collection('feed_checkin').find({
        feed_date: today
      }, { limit: 1000 })

      // 聚合成 { cat_id: { total, meal, snack } }
      const summary = {}
      for (const r of (records || [])) {
        if (!summary[r.cat_id]) {
          summary[r.cat_id] = { total: 0, meal: 0, snack: 0 }
        }
        summary[r.cat_id].total++
        if (r.feed_category === 'snack') {
          summary[r.cat_id].snack++
        } else {
          summary[r.cat_id].meal++
        }
      }
      return { msg: '获取成功', result: true, data: summary }
    } catch (error) {
      return { msg: '获取失败', error, result: false }
    }
  }

  // 我的打卡记录（普通用户）
  if (operation === 'listMine') {
    try {
      const { result: records } = await db.collection('feed_checkin').find({
        _openid: openid
      }, {
        sort: { created_at: -1 },
        limit: 100
      })
      return { msg: '获取成功', result: true, data: records }
    } catch (error) {
      return { msg: '获取失败', error, result: false }
    }
  }

  // ========== 打卡（普通用户） ==========

  // 打卡（喂食/零食合并，统一用 food_type 记录喂了什么）
  if (operation === 'checkin') {
    const { cat_id, feed_date, feed_time, location, note, user_name, food_type } = ctx.args.data || {}
    if (!cat_id || !feed_date) {
      return { msg: '缺少必要字段（猫咪、喂食日期）', result: false }
    }
    if (!food_type) {
      return { msg: '请选择喂了什么', result: false }
    }

    // 校验猫咪存在
    const { result: cat } = await db.collection('cat').findOne({ _id: cat_id })
    if (!cat || cat.deleted === 1) {
      return { msg: '猫咪不存在', result: false }
    }

    // 同一用户同一天对同一只猫只能打卡一次
    const { result: existCount } = await db.collection('feed_checkin').count({
      cat_id: cat_id,
      _openid: openid,
      feed_date: feed_date
    })
    if (existCount > 0) {
      return { msg: '今天已经给这只猫猫打过卡啦', result: false }
    }

    const checkinData = {
      cat_id: cat_id,
      cat_name: cat.name || '',
      campus: cat.campus || '',
      area: cat.area || '',
      _openid: openid,
      user_name: user_name || '',
      feed_category: 'meal', // 兼容字段：合并后新记录统一为 meal
      snack_type: '',
      food_type: food_type,
      feed_date: feed_date,       // yyyy-MM-dd
      feed_time: feed_time || '', // HH:mm
      location: location || '',
      note: note || '',
      created_at: new Date()
    }

    try {
      const { result } = await db.collection('feed_checkin').insertOne(checkinData)
      return { msg: '打卡成功', result: true, data: result }
    } catch (error) {
      return { msg: '打卡失败', error, result: false }
    }
  }

  // 删除打卡记录（仅本人或管理员）
  if (operation === 'remove') {
    const checkin_id = ctx.args.checkin_id
    if (!checkin_id) {
      return { msg: '缺少打卡ID', result: false }
    }

    const { result: record } = await db.collection('feed_checkin').findOne({ _id: checkin_id })
    if (!record) {
      return { msg: '记录不存在', result: false }
    }

    const is_manager = await checkManager(ctx, openid, 1)
    if (record._openid !== openid && !is_manager) {
      return { msg: '只能删除自己的打卡记录', result: false }
    }

    try {
      await db.collection('feed_checkin').deleteOne({ _id: checkin_id })
      return { msg: '删除成功', result: true }
    } catch (error) {
      return { msg: '删除失败', error, result: false }
    }
  }

  // ========== 地点与零食类型管理（管理员） ==========

  // 添加打卡地点
  if (operation === 'addLocation') {
    if (!(await checkManager(ctx, openid, 2))) {
      return { msg: 'not a manager', result: false }
    }
    const location = (ctx.args.location || '').trim()
    if (!location) {
      return { msg: '缺少地点名称', result: false }
    }
    try {
      const setting = await getSetting(db, 'feed_location')
      const locations = (setting && setting.locations) || []
      if (locations.includes(location)) {
        return { msg: '地点已存在', result: false }
      }
      locations.push(location)
      await saveSetting(db, 'feed_location', { locations: locations })
      return { msg: '添加成功', result: true, data: locations }
    } catch (error) {
      return { msg: '添加失败', error, result: false }
    }
  }

  // 删除打卡地点
  if (operation === 'removeLocation') {
    if (!(await checkManager(ctx, openid, 2))) {
      return { msg: 'not a manager', result: false }
    }
    const location = ctx.args.location
    if (!location) {
      return { msg: '缺少地点名称', result: false }
    }
    try {
      const setting = await getSetting(db, 'feed_location')
      const locations = ((setting && setting.locations) || []).filter(l => l !== location)
      await saveSetting(db, 'feed_location', { locations: locations })
      return { msg: '删除成功', result: true, data: locations }
    } catch (error) {
      return { msg: '删除失败', error, result: false }
    }
  }

  // 添加零食类型
  if (operation === 'addSnackType') {
    if (!(await checkManager(ctx, openid, 2))) {
      return { msg: 'not a manager', result: false }
    }
    const type = (ctx.args.type || '').trim()
    if (!type) {
      return { msg: '缺少类型名称', result: false }
    }
    try {
      const setting = await getSetting(db, 'feed_snack_type')
      const types = (setting && setting.types) || DEFAULT_SNACK_TYPES.slice()
      if (types.includes(type)) {
        return { msg: '类型已存在', result: false }
      }
      types.push(type)
      await saveSetting(db, 'feed_snack_type', { types: types })
      return { msg: '添加成功', result: true, data: types }
    } catch (error) {
      return { msg: '添加失败', error, result: false }
    }
  }

  // 删除零食类型（使用中的不允许删除）
  if (operation === 'removeSnackType') {
    if (!(await checkManager(ctx, openid, 2))) {
      return { msg: 'not a manager', result: false }
    }
    const type = ctx.args.type
    if (!type) {
      return { msg: '缺少类型名称', result: false }
    }
    try {
      const { result: inUseCount } = await db.collection('feed_checkin').count({
        $or: [{ snack_type: type }, { food_type: type }]
      })
      if (inUseCount > 0) {
        return { msg: `该类型已有 ${inUseCount} 条打卡记录，无法删除`, result: false }
      }

      const setting = await getSetting(db, 'feed_snack_type')
      const types = ((setting && setting.types) || DEFAULT_SNACK_TYPES.slice()).filter(t => t !== type)
      if (types.length === 0) {
        return { msg: '必须至少保留一种零食类型', result: false }
      }
      await saveSetting(db, 'feed_snack_type', { types: types })
      return { msg: '删除成功', result: true, data: types }
    } catch (error) {
      return { msg: '删除失败', error, result: false }
    }
  }

  return { msg: '未知操作', result: false }
}
