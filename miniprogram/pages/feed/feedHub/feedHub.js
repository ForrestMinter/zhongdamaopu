// 分地区喂食打卡主页：校区 → 区域 → 猫咪，显示今日打卡情况
import { getAvatar } from "../../../utils/cat";
import api from "../../../utils/cloudApi";

const app = getApp();

Page({
  data: {
    campusList: [],        // 校区名列表
    activeCampus: '',
    areaGroups: [],        // 当前校区的 [{area, cats: [{...} , today}]}]
    todayTotal: 0,         // 全校区今日打卡总数
    loading: true,
  },

  jsData: {
    catsByCampus: {},      // campus -> cats[]
    todaySummary: {},      // cat_id -> {total, meal, snack}
    avatarLoaded: {},      // campus -> bool
  },

  async onLoad() {
    await this.loadData();
  },

  async onShow() {
    // 打卡返回后刷新今日数据
    if (this.data.campusList.length) {
      await this.refreshTodaySummary();
      this.buildAreaGroups();
    }
  },

  async loadData() {
    this.setData({ loading: true });
    try {
      // 所有在册猫咪
      let cats = [];
      const { result: total } = await app.mpServerless.db.collection('cat').count({ deleted: { $ne: 1 } });
      const pools = [];
      for (let i = 0; i < total; i += 100) {
        pools.push(app.mpServerless.db.collection('cat').find(
          { deleted: { $ne: 1 } },
          { skip: i, limit: 100 }
        ));
      }
      const results = await Promise.all(pools);
      for (const r of results) {
        if (r.result) cats = cats.concat(r.result);
      }

      // 按校区分组
      const catsByCampus = {};
      for (const cat of cats) {
        const campus = cat.campus || '未知校区';
        if (!catsByCampus[campus]) catsByCampus[campus] = [];
        catsByCampus[campus].push(cat);
      }
      this.jsData.catsByCampus = catsByCampus;

      await this.refreshTodaySummary();

      const campusList = Object.keys(catsByCampus);
      this.setData({
        campusList,
        activeCampus: campusList[0] || '',
      });

      await this.loadAvatars(this.data.activeCampus);
      this.buildAreaGroups();
    } catch (err) {
      console.error('[loadData] - 加载猫咪失败:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 今日各猫打卡汇总
  async refreshTodaySummary() {
    try {
      const res = await api.feedOp({ operation: 'todayFeedSummary' });
      if (res.result) {
        this.jsData.todaySummary = res.data || {};
        const todayTotal = Object.values(this.jsData.todaySummary)
          .reduce((sum, item) => sum + item.total, 0);
        this.setData({ todayTotal });
      }
    } catch (err) {
      console.error('[refreshTodaySummary] - 加载今日打卡汇总失败:', err);
    }
  },

  // 按需加载当前校区猫咪头像
  async loadAvatars(campus) {
    if (!campus || this.jsData.avatarLoaded[campus]) return;
    const cats = this.jsData.catsByCampus[campus] || [];
    const ids = cats.map(c => c._id);
    try {
      const avatars = await getAvatar(ids);
      ids.forEach((id, i) => {
        const cat = cats.find(c => c._id === id);
        if (cat) cat.avatar = avatars[i];
      });
      this.jsData.avatarLoaded[campus] = true;
    } catch (err) {
      console.error('[loadAvatars] - 加载头像失败:', err);
    }
  },

  // 组装当前校区的 区域→猫咪 分组
  buildAreaGroups() {
    const campus = this.data.activeCampus;
    const cats = this.jsData.catsByCampus[campus] || [];
    const summary = this.jsData.todaySummary;

    const areaMap = {};
    for (const cat of cats) {
      const area = cat.area || '其他区域';
      if (!areaMap[area]) areaMap[area] = [];
      const today = summary[cat._id] || { total: 0, meal: 0, snack: 0 };
      areaMap[area].push({
        _id: cat._id,
        name: cat.name,
        avatarUrl: cat.avatar ? (cat.avatar.photo_compressed || cat.avatar.photo_id) : '',
        today_total: today.total,
        today_meal: today.meal,
        today_snack: today.snack,
      });
    }

    const areaGroups = Object.keys(areaMap).map(area => {
      const catsInArea = areaMap[area];
      // 未打卡的排前面，方便找到还没喂的猫
      catsInArea.sort((a, b) => a.today_total - b.today_total);
      return {
        area,
        cats: catsInArea,
        area_today: catsInArea.reduce((sum, c) => sum + c.today_total, 0),
      };
    });
    // 按区域今日打卡数升序，没喂的区域优先展示
    areaGroups.sort((a, b) => a.area_today - b.area_today);

    this.setData({ areaGroups });
  },

  async switchCampus(e) {
    const campus = e.currentTarget.dataset.campus;
    if (campus === this.data.activeCampus) return;
    this.setData({ activeCampus: campus, areaGroups: [] });
    await this.loadAvatars(campus);
    this.buildAreaGroups();
  },

  // 跳转猫咪的打卡页
  toFeedRecord(e) {
    const { cat_id, category } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/feed/feedRecord/feedRecord?cat_id=${cat_id}&category=${category || 'meal'}`,
    });
  },

  // 跳转猫咪详情
  toCatDetail(e) {
    const cat_id = e.currentTarget.dataset.cat_id;
    wx.navigateTo({
      url: '/pages/genealogy/detailCat/detailCat?cat_id=' + cat_id,
    });
  },
});
