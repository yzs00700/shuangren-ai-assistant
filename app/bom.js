'use strict';

/* ============================================================
   BOM 报价 · 多品类成本核算
   数据保存在浏览器 localStorage（Edge 配置在包内 temp\edge_profile）
   ============================================================ */

var STORE_KEY = 'creo_ai_bom_v1';

var CATS = [
  {
    id: 'plastic', name: '塑料件', cls: 'cat-plastic',
    defaults: { volumeCm3: 100, density: 1.05, matPrice: 12.8, machineRate: 45, cycleSec: 30, cavities: 1, surfaceCost: 0, moldCost: 0, moldQty: 10000 },
    fields: [
      { k: 'volumeCm3', label: '零件体积', unit: 'cm³', step: 0.01 },
      { k: 'density', label: '材料密度', unit: 'g/cm³', step: 0.01 },
      { k: 'matPrice', label: '材料单价', unit: '元/kg', step: 0.1 },
      { k: 'machineRate', label: '注塑机时费', unit: '元/小时', step: 1 },
      { k: 'cycleSec', label: '成型周期', unit: '秒', step: 0.5 },
      { k: 'cavities', label: '每模腔数', unit: '腔', step: 1 },
      { k: 'surfaceCost', label: '表面处理费', unit: '元/件', step: 0.1 },
      { k: 'moldCost', label: '模具费', unit: '元', step: 100 },
      { k: 'moldQty', label: '模具摊销数量', unit: '件', step: 100 }
    ]
  },
  {
    id: 'sheet', name: '钣金件', cls: 'cat-sheet',
    defaults: { areaM2: 0.12, thicknessMm: 1.5, density: 7.85, matPrice: 6.5, laserCost: 3, bends: 4, bendCost: 0.8, weldCost: 0, surfaceCost: 0, moldCost: 0, moldQty: 1000 },
    fields: [
      { k: 'areaM2', label: '展开面积', unit: 'm²', step: 0.001 },
      { k: 'thicknessMm', label: '板厚', unit: 'mm', step: 0.1 },
      { k: 'density', label: '材料密度', unit: 'g/cm³', step: 0.01 },
      { k: 'matPrice', label: '材料单价', unit: '元/kg', step: 0.1 },
      { k: 'laserCost', label: '激光/冲切费', unit: '元/件', step: 0.1 },
      { k: 'bends', label: '折弯刀数', unit: '刀', step: 1 },
      { k: 'bendCost', label: '每刀折弯费', unit: '元/刀', step: 0.1 },
      { k: 'weldCost', label: '焊接费', unit: '元/件', step: 0.1 },
      { k: 'surfaceCost', label: '表面处理费', unit: '元/件', step: 0.1 },
      { k: 'moldCost', label: '模具/工装费', unit: '元', step: 100 },
      { k: 'moldQty', label: '摊销数量', unit: '件', step: 100 }
    ]
  },
  {
    id: 'profile', name: '铝型材', cls: 'cat-profile', unit: '根',
    defaults: { lengthM: 1.0, weightPerM: 0.9, density: 2.70, matPrice: 24, cutCost: 1.5, machineCost: 0, surfaceCost: 0 },
    fields: [
      { k: 'lengthM', label: '单件长度', unit: 'm', step: 0.01 },
      { k: 'weightPerM', label: '米重（自制按实测）', unit: 'kg/m', step: 0.001 },
      { k: 'matPrice', label: '材料单价', unit: '元/kg', step: 0.1 },
      { k: 'cutCost', label: '切割费', unit: '元/件', step: 0.1 },
      { k: 'machineCost', label: '钻孔/攻丝费', unit: '元/件', step: 0.1 },
      { k: 'surfaceCost', label: '表面处理费', unit: '元/件', step: 0.1 }
    ]
  },
  {
    id: 'diecast', name: '铸造件', cls: 'cat-diecast',
    defaults: { volumeCm3: 60, density: 2.7, matPrice: 18, machineRate: 120, cycleSec: 60, cavities: 1, deburrCost: 0.5, surfaceCost: 0, moldCost: 0, moldQty: 50000, castingMethod: 'diecast' },
    fields: [
      { k: 'volumeCm3', label: '零件体积', unit: 'cm³', step: 0.01 },
      { k: 'density', label: '材料密度', unit: 'g/cm³', step: 0.01 },
      { k: 'matPrice', label: '材料单价', unit: '元/kg', step: 0.1 },
      { k: 'machineRate', label: '铸造机时费', unit: '元/小时', step: 1 },
      { k: 'cycleSec', label: '铸造周期', unit: '秒', step: 0.5 },
      { k: 'cavities', label: '每模腔数', unit: '腔', step: 1 },
      { k: 'deburrCost', label: '去毛刺/清理', unit: '元/件', step: 0.1 },
      { k: 'surfaceCost', label: '表面处理费', unit: '元/件', step: 0.1 },
      { k: 'moldCost', label: '模具费', unit: '元', step: 100 },
      { k: 'moldQty', label: '模具摊销数量', unit: '件', step: 100 }
    ]
  },
  {
    id: 'cnc', name: 'CNC 件', cls: 'cat-cnc',
    defaults: { blankVolumeCm3: 150, density: 7.85, matPrice: 8, machineRate: 80, hours: 0.5, programCost: 0, batchQty: 100, surfaceCost: 0 },
    fields: [
      { k: 'blankVolumeCm3', label: '毛坯体积', unit: 'cm³', step: 0.01 },
      { k: 'density', label: '材料密度', unit: 'g/cm³', step: 0.01 },
      { k: 'matPrice', label: '材料单价', unit: '元/kg', step: 0.1 },
      { k: 'machineRate', label: 'CNC 机时费', unit: '元/小时', step: 1 },
      { k: 'hours', label: '单件工时', unit: '小时', step: 0.05 },
      { k: 'programCost', label: '编程/打样费', unit: '元', step: 10 },
      { k: 'batchQty', label: '编程费摊销数量', unit: '件', step: 10 },
      { k: 'surfaceCost', label: '表面处理费', unit: '元/件', step: 0.1 }
    ]
  },
  {
    id: 'print3d', name: '3D 打印件', cls: 'cat-print3d',
    defaults: { volumeCm3: 30, density: 1.24, matPrice: 180, printHours: 2, machineRate: 15, postCost: 5, surfaceCost: 0 },
    fields: [
      { k: 'volumeCm3', label: '零件体积', unit: 'cm³', step: 0.01 },
      { k: 'density', label: '材料密度', unit: 'g/cm³', step: 0.01 },
      { k: 'matPrice', label: '材料单价', unit: '元/kg', step: 1 },
      { k: 'printHours', label: '打印时间', unit: '小时', step: 0.1 },
      { k: 'machineRate', label: '机时费', unit: '元/小时', step: 1 },
      { k: 'postCost', label: '后处理/支撑', unit: '元/件', step: 0.5 },
      { k: 'surfaceCost', label: '表面处理费', unit: '元/件', step: 0.1 }
    ]
  },
  {
    id: 'electric', name: '电器件', cls: 'cat-electric',
    defaults: { purchasePrice: 25, testCost: 1, harnessCost: 0 },
    fields: [
      { k: 'purchasePrice', label: '采购单价', unit: '元/件', step: 0.1 },
      { k: 'testCost', label: '测试/老化费', unit: '元/件', step: 0.1 },
      { k: 'harnessCost', label: '线束加工费', unit: '元/件', step: 0.1 }
    ]
  },
  {
    id: 'fastener', name: '紧固件', cls: 'cat-fastener',
    defaults: { purchasePrice: 0.12, surfaceCost: 0 },
    fields: [
      { k: 'purchasePrice', label: '采购单价', unit: '元/件', step: 0.01 },
      { k: 'surfaceCost', label: '表面处理费', unit: '元/件', step: 0.01 }
    ]
  },
  {
    id: 'wire', name: '线材', cls: 'cat-wire',
    defaults: { lengthM: 1.2, weightPerM: 0.02, pricePerM: 2.5, terminals: 4, terminalPrice: 0.15, laborCost: 0.8 },
    fields: [
      { k: 'lengthM', label: '单件长度', unit: '米', step: 0.01 },
      { k: 'weightPerM', label: '每米重量', unit: 'kg/m', step: 0.001 },
      { k: 'pricePerM', label: '线材单价', unit: '元/米', step: 0.1 },
      { k: 'terminals', label: '端子数量', unit: '个', step: 1 },
      { k: 'terminalPrice', label: '端子单价', unit: '元/个', step: 0.01 },
      { k: 'laborCost', label: '压接/组装费', unit: '元/件', step: 0.1 }
    ]
  },
  {
    id: 'other', name: '其他/外购', cls: 'cat-other',
    defaults: { purchasePrice: 10, processCost: 0 },
    fields: [
      { k: 'purchasePrice', label: '采购单价', unit: '元/件', step: 0.1 },
      { k: 'processCost', label: '二次加工费', unit: '元/件', step: 0.1 }
    ]
  },
  {
    id: 'bomitem', name: 'BOM导入件', cls: 'cat-bomitem', unit: '件',
    defaults: { unitWeightG: 100, matPrice: 20, processCost: 0, surfaceCost: 0 },
    fields: [
      { k: 'unitWeightG', label: '单重', unit: 'g', step: 0.01 },
      { k: 'matPrice', label: '材料单价', unit: '元/kg', step: 0.1 },
      { k: 'processCost', label: '加工费', unit: '元/件', step: 0.1 },
      { k: 'surfaceCost', label: '表面处理费', unit: '元/件', step: 0.1 }
    ]
  }
];

var CATMAP = {};
CATS.forEach(function (c) { CATMAP[c.id] = c; });

var CUR = {
  CNY: { symbol: '¥', name: 'CNY' },
  USD: { symbol: '$', name: 'USD' },
  EUR: { symbol: '€', name: 'EUR' }
};

var state = {
  project: { name: '', customer: '', date: '', currency: 'CNY' },
  rates: {
    mgmt: 8, profit: 12, tax: 13, freight: 0, other: 0,
    region: 'east',
    market: {}, marketAt: '', marketSource: '',
    materialOverrides: {}, processOverrides: {}, surfaceOverrides: {}
  },
  rows: [],
  bomRows: [],
  bomMeta: { template: '常用（默认）' },
  filter: 'all',
  search: '',
  sel: null
};

var editing = null;
var editingIsNew = false;

/* ---------------- 基础工具 ---------------- */
function $(id) { return document.getElementById(id); }
function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
function uid() { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }
function sym() { return (CUR[state.project.currency] || CUR.CNY).symbol; }
function money(v, digits) {
  var n = num(v);
  var d = digits === undefined ? 2 : digits;
  return sym() + n.toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function today() {
  var d = new Date();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}

/* ---------------- 行与计算 ---------------- */
function newRow(cat) {
  var c = CATMAP[cat] || CATMAP.other;
  var row = {
    id: uid(), cat: c.id, name: '', spec: '', qty: 1, unit: c.unit || '件',
    loss: 0, remark: '', p: deepCopy(c.defaults),
    matKey: '', surfaceKey: 'none'
  };
  // 新行直接套用当前地区系数和网价；老数据在 load() 里补齐材料键。
  if (typeof applyRatesToRow === 'function') {
    if (materialList(row.cat).length) row.matKey = defaultMatKey(row.cat);
    applyRatesToRow(row, true);
  }
  return row;
}

function calcRow(r) {
  var p = r.p || {};
  var qty = Math.max(0, num(r.qty));
  var weight = 0, mat = 0, proc = 0, surf = 0, mold = 0, buy = 0;
  switch (r.cat) {
    case 'plastic':
      weight = num(p.volumeCm3) * num(p.density);
      mat = weight / 1000 * num(p.matPrice);
      proc = num(p.machineRate) * num(p.cycleSec) / 3600 / Math.max(1, num(p.cavities));
      surf = num(p.surfaceCost);
      mold = num(p.moldCost) / Math.max(1, num(p.moldQty));
      break;
    case 'sheet':
      weight = num(p.areaM2) * num(p.thicknessMm) * 1000 * num(p.density);
      mat = weight / 1000 * num(p.matPrice);
      proc = num(p.laserCost) + num(p.bends) * num(p.bendCost) + num(p.weldCost);
      surf = num(p.surfaceCost);
      mold = num(p.moldCost) / Math.max(1, num(p.moldQty));
      break;
    case 'profile':
      weight = num(p.lengthM) * num(p.weightPerM) * 1000;
      mat = weight / 1000 * num(p.matPrice);
      proc = num(p.cutCost) + num(p.machineCost);
      surf = num(p.surfaceCost);
      break;
    case 'diecast':
      weight = num(p.volumeCm3) * num(p.density);
      mat = weight / 1000 * num(p.matPrice);
      proc = num(p.machineRate) * num(p.cycleSec) / 3600 / Math.max(1, num(p.cavities))
        + num(p.deburrCost);
      surf = num(p.surfaceCost);
      mold = num(p.moldCost) / Math.max(1, num(p.moldQty));
      break;
    case 'cnc':
      weight = num(p.blankVolumeCm3) * num(p.density);
      mat = weight / 1000 * num(p.matPrice);
      proc = num(p.machineRate) * num(p.hours)
        + num(p.programCost) / Math.max(1, num(p.batchQty));
      surf = num(p.surfaceCost);
      break;
    case 'print3d':
      weight = num(p.volumeCm3) * num(p.density);
      mat = weight / 1000 * num(p.matPrice);
      proc = num(p.printHours) * num(p.machineRate) + num(p.postCost);
      surf = num(p.surfaceCost);
      break;
    case 'electric':
      buy = num(p.purchasePrice) + num(p.testCost) + num(p.harnessCost);
      break;
    case 'fastener':
      buy = num(p.purchasePrice);
      surf = num(p.surfaceCost);
      break;
    case 'wire':
      weight = num(p.lengthM) * num(p.weightPerM) * 1000;
      buy = num(p.lengthM) * num(p.pricePerM)
        + num(p.terminals) * num(p.terminalPrice) + num(p.laborCost);
      break;
    case 'bomitem':
      weight = num(p.unitWeightG);
      mat = weight / 1000 * num(p.matPrice);
      proc = num(p.processCost);
      surf = num(p.surfaceCost);
      break;
    default:
      buy = num(p.purchasePrice) + num(p.processCost);
      break;
  }
  var loss = (mat + proc + surf + mold + buy) * num(r.loss) / 100;
  var unit = mat + proc + surf + mold + buy + loss;
  return {
    weight: weight, mat: mat, proc: proc, surf: surf, mold: mold, buy: buy,
    loss: loss, unit: unit, total: unit * qty, qty: qty
  };
}

function totals() {
  var t = {
    items: state.rows.length, qty: 0, weight: 0, mat: 0, proc: 0, surf: 0,
    mold: 0, buy: 0, loss: 0, subtotal: 0, extra: 0, mgmt: 0, profit: 0,
    tax: 0, grand: 0
  };
  state.rows.forEach(function (r) {
    var c = calcRow(r);
    t.qty += c.qty;
    t.weight += c.weight * c.qty;
    t.mat += c.mat * c.qty;
    t.proc += c.proc * c.qty;
    t.surf += c.surf * c.qty;
    t.mold += c.mold * c.qty;
    t.buy += c.buy * c.qty;
    t.loss += c.loss * c.qty;
  });
  t.subtotal = t.mat + t.proc + t.surf + t.mold + t.buy + t.loss;
  t.extra = num(state.rates.freight) + num(state.rates.other);
  var base = t.subtotal + t.extra;
  t.mgmt = base * num(state.rates.mgmt) / 100;
  t.profit = (base + t.mgmt) * num(state.rates.profit) / 100;
  t.tax = (base + t.mgmt + t.profit) * num(state.rates.tax) / 100;
  t.grand = base + t.mgmt + t.profit + t.tax;
  return t;
}

/* ---------------- 保存 / 读取 ---------------- */
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      project: state.project, rates: state.rates, rows: state.rows,
      bomRows: state.bomRows, bomMeta: state.bomMeta
    }));
  } catch (e) { /* 隐私模式或磁盘满时忽略 */ }
}

function load() {
  try {
    var raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    var d = JSON.parse(raw);
    if (d.project) Object.assign(state.project, d.project);
    if (d.rates) Object.assign(state.rates, d.rates);
    if (Array.isArray(d.bomRows)) state.bomRows = d.bomRows;
    if (d.bomMeta) Object.assign(state.bomMeta, d.bomMeta);
    state.rates.market = state.rates.market || {};
    state.rates.materialOverrides = state.rates.materialOverrides || {};
    state.rates.processOverrides = state.rates.processOverrides || {};
    state.rates.surfaceOverrides = state.rates.surfaceOverrides || {};
    if (typeof regionById === 'function' &&
        regionById(state.rates.region).id !== state.rates.region) {
      state.rates.region = 'east';
    }
    if (Array.isArray(d.rows)) {
      state.rows = d.rows.filter(function (r) { return r && CATMAP[r.cat]; });
      state.rows.forEach(function (r) {
        var def = CATMAP[r.cat].defaults;
        r.p = Object.assign({}, def, r.p || {});
        r.qty = num(r.qty) || 1;
        r.loss = num(r.loss);
        if (typeof materialList === 'function') {
          if (materialList(r.cat).length &&
              (!r.matKey || !materialInfo(r.cat, r.matKey))) {
            r.matKey = defaultMatKey(r.cat);
          }
          if (!r.surfaceKey) r.surfaceKey = 'none';
        }
      });
    }
  } catch (e) { /* 数据损坏时从空开始 */ }
}

/* ---------------- 渲染：品类筛选 ---------------- */
function renderChips() {
  var counts = { all: state.rows.length };
  CATS.forEach(function (c) { counts[c.id] = 0; });
  state.rows.forEach(function (r) { counts[r.cat] = (counts[r.cat] || 0) + 1; });

  var html = '<span class="chip' + (state.filter === 'all' ? ' on' : '') +
    '" data-cat="all">全部<span class="n">' + counts.all + '</span></span>';
  CATS.forEach(function (c) {
    if (!counts[c.id]) return;
    html += '<span class="chip' + (state.filter === c.id ? ' on' : '') +
      '" data-cat="' + c.id + '">' + c.name +
      '<span class="n">' + counts[c.id] + '</span></span>';
  });
  $('cats').innerHTML = html;
}

/* ---------------- 渲染：表格 ---------------- */
function visibleRows() {
  var q = state.search.trim().toLowerCase();
  return state.rows.filter(function (r) {
    if (state.filter !== 'all' && r.cat !== state.filter) return false;
    if (!q) return true;
    var c = CATMAP[r.cat];
    var hay = [r.name, r.spec, r.remark, c ? c.name : '', r.unit].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  });
}

function renderRows() {
  var rows = visibleRows();
  var body = $('rows');
  var html = '';
  rows.forEach(function (r, i) {
    var c = calcRow(r);
    var cat = CATMAP[r.cat];
    var idx = state.rows.indexOf(r) + 1;
    var meta = [];
    if (!r.spec && typeof materialInfo === 'function') {
      var mi = materialInfo(r.cat, r.matKey);
      if (mi) meta.push(mi.name);
    }
    if (r.cat === 'diecast' && r.p.castingMethod &&
        typeof castingMethodInfo === 'function') {
      meta.push('工艺：' + castingMethodInfo(r.p.castingMethod).name);
    }
    if (r.surfaceKey && r.surfaceKey !== 'none' && typeof surfaceInfo === 'function') {
      meta.push('表面：' + surfaceInfo(r.surfaceKey).name);
    }
    var specText = r.spec || '';
    if (meta.length) specText = (specText ? specText + ' · ' : '') + meta.join(' · ');
    html += '<tr data-id="' + r.id + '"' + (state.sel === r.id ? ' class="sel"' : '') + '>' +
      '<td class="c-no">' + idx + '</td>' +
      '<td><span class="catbadge ' + cat.cls + '">' + cat.name + '</span></td>' +
      '<td><div class="pname">' + (esc(r.name) || '<span style="color:#9aa5b8">未命名</span>') + '</div>' +
        (specText ? '<div class="pspec">' + esc(specText) + '</div>' : '') + '</td>' +
      '<td class="c-qty"><input class="qtyin" type="number" min="0" step="1" value="' + num(r.qty) +
        '" data-id="' + r.id + '"> <span class="unit">' + esc(r.unit) + '</span></td>' +
      '<td class="c-num">' + (c.weight > 0 ? c.weight.toFixed(c.weight < 10 ? 2 : 1) : '—') + '</td>' +
      '<td class="c-num">' + money(c.mat) + '</td>' +
      '<td class="c-num">' + money(c.proc) + '</td>' +
      '<td class="c-num">' + money(c.surf) + '</td>' +
      '<td class="c-num">' + money(c.mold) + '</td>' +
      '<td class="c-num">' + money(c.buy) + '</td>' +
      '<td class="c-num"><b>' + money(c.unit) + '</b></td>' +
      '<td class="c-num"><b>' + money(c.total) + '</b></td>' +
      '<td class="c-act"><button class="del" data-del="' + r.id + '" title="删除">&times;</button></td>' +
      '</tr>';
  });
  body.innerHTML = html;
  var qc = document.getElementById('quoteRowCount');
  if (qc) qc.textContent = '共 ' + state.rows.length + ' 项';
  $('empty').classList.toggle('show', state.rows.length === 0);
  $('bom').style.display = state.rows.length === 0 ? 'none' : '';
  renderFooter();
}

function renderFooter() {
  var t = totals();
  $('tWeight').textContent = t.weight > 0 ? (t.weight / 1000).toFixed(2) + ' kg' : '—';
  $('tMat').textContent = money(t.mat);
  $('tProc').textContent = money(t.proc);
  $('tSurf').textContent = money(t.surf);
  $('tMold').textContent = money(t.mold);
  $('tBuy').textContent = money(t.buy);
  $('tUnit').textContent = '—';
  $('tTotal').textContent = money(t.subtotal);
}

/* ---------------- 渲染：汇总 ---------------- */
function renderSummary() {
  var t = totals();
  $('sItems').textContent = t.items;
  $('sQty').textContent = t.qty;
  $('sMat').textContent = money(t.mat);
  $('sProc').textContent = money(t.proc);
  $('sSurf').textContent = money(t.surf);
  $('sMold').textContent = money(t.mold);
  $('sBuy').textContent = money(t.buy);
  $('sLoss').textContent = money(t.loss);
  $('sSub').textContent = money(t.subtotal);
  $('sExtra').textContent = money(t.extra);
  $('sMgmt').textContent = money(t.mgmt);
  $('sProfit').textContent = money(t.profit);
  $('sTax').textContent = money(t.tax);
  $('grand').textContent = money(t.grand);
}

function render() {
  renderChips();
  renderRows();
  renderSummary();
}

/* ---------------- 弹窗：行编辑 ---------------- */
function openEditor(id, cat) {
  if (id) {
    var r = state.rows.find(function (x) { return x.id === id; });
    if (!r) return;
    editing = deepCopy(r);
    editingIsNew = false;
    if (typeof materialList === 'function') {
      if (materialList(editing.cat).length &&
          (!editing.matKey || !materialInfo(editing.cat, editing.matKey))) {
        editing.matKey = defaultMatKey(editing.cat);
      }
      if (!editing.surfaceKey) editing.surfaceKey = 'none';
    }
    $('dTitle').textContent = '编辑零件';
    $('dDelete').style.display = '';
  } else {
    editing = newRow(cat || 'plastic');
    editingIsNew = true;
    $('dTitle').textContent = '添加零件';
    $('dDelete').style.display = 'none';
  }
  state.sel = editing.id;
  renderRows();

  $('fCat').innerHTML = CATS.map(function (c) {
    return '<option value="' + c.id + '"' + (c.id === editing.cat ? ' selected' : '') + '>' +
      c.name + '</option>';
  }).join('');
  $('fQty').value = editing.qty;
  $('fName').value = editing.name;
  $('fSpec').value = editing.spec;
  $('fLoss').value = editing.loss;
  $('fUnit').value = editing.unit;
  $('fRemark').value = editing.remark;
  renderFields();
  updatePreview();
  $('modal').classList.add('show');
  var db = $('modal').querySelector('.dbody');
  if (db) db.scrollTop = 0;
  setTimeout(function () { $('fName').focus(); }, 60);
}

function renderFields() {
  var c = CATMAP[editing.cat];
  var html = '';

  // 材料牌号下拉：选择后自动带出密度和当前地区/网价参考单价。
  var mats = (typeof materialList === 'function') ? materialList(editing.cat) : [];
  if (mats.length) {
    if (!editing.matKey || !materialInfo(editing.cat, editing.matKey)) {
      editing.matKey = defaultMatKey(editing.cat);
    }
    html += '<label class="wide">材料牌号<select id="fMat">' +
      materialOptionsHtml(editing.cat, editing.matKey) + '</select></label>';
  }

  // 表面处理下拉：选择后自动带出地区参考单价，仍可在下面手工改。
  if (typeof SURFACE_CATS !== 'undefined' && SURFACE_CATS[editing.cat]) {
    if (!editing.surfaceKey) editing.surfaceKey = 'none';
    html += '<label class="wide">表面处理<select id="fSurface">' +
      surfaceOptionsHtml(editing.surfaceKey) + '</select></label>';
  }

  // 铸造工艺：压铸/重力/砂型/熔模/低压，选择后带出机时和周期。
  if (editing.cat === 'diecast' && typeof CASTING_METHODS !== 'undefined') {
    if (!editing.p.castingMethod) editing.p.castingMethod = 'diecast';
    html += '<label class="wide">铸造工艺<select id="fCastMethod">' +
      CASTING_METHODS.map(function (m) {
        return '<option value="' + m.key + '"' +
          (m.key === editing.p.castingMethod ? ' selected' : '') + '>' +
          esc(m.name) + '</option>';
      }).join('') + '</select></label>';
  }

  html += c.fields.map(function (f) {
    var v = editing.p[f.k];
    if (v === undefined || v === null) v = '';
    return '<label>' + esc(f.label) +
      (f.unit ? '<span class="unit">(' + esc(f.unit) + ')</span>' : '') +
      '<input type="number" step="' + (f.step || 'any') + '" data-k="' + f.k +
      '" value="' + esc(v) + '"></label>';
  }).join('');

  $('fields').innerHTML = html;
}

function updatePreview() {
  var c = calcRow(editing);
  $('preview').innerHTML =
    '<div><span>单重</span> <b>' + (c.weight > 0 ? c.weight.toFixed(2) + ' g' : '—') + '</b></div>' +
    '<div><span>材料</span> <b>' + money(c.mat) + '</b></div>' +
    '<div><span>加工</span> <b>' + money(c.proc) + '</b></div>' +
    '<div><span>外购/其他</span> <b>' + money(c.buy + c.surf + c.mold) + '</b></div>' +
    '<div><span>单价</span> <b>' + money(c.unit) + '</b></div>' +
    '<div><span>小计</span> <b>' + money(c.total) + '</b></div>';
}

function collectEditor() {
  editing.cat = $('fCat').value;
  editing.qty = Math.max(0, num($('fQty').value));
  editing.name = $('fName').value.trim();
  editing.spec = $('fSpec').value.trim();
  editing.loss = Math.max(0, num($('fLoss').value));
  editing.unit = $('fUnit').value;
  editing.remark = $('fRemark').value.trim();
  document.querySelectorAll('#fields input[data-k]').forEach(function (inp) {
    editing.p[inp.dataset.k] = num(inp.value);
  });
  var fm = $('fMat');
  if (fm) editing.matKey = fm.value;
  var fs = $('fSurface');
  if (fs) editing.surfaceKey = fs.value;
}

function saveEditor() {
  collectEditor();
  if (!editing.name) {
    editing.name = CATMAP[editing.cat].name + ' ' + (state.rows.length + 1);
  }
  if (editingIsNew) {
    state.rows.push(editing);
  } else {
    var i = state.rows.findIndex(function (x) { return x.id === editing.id; });
    if (i >= 0) state.rows[i] = editing;
  }
  state.sel = editing.id;
  $('modal').classList.remove('show');
  save();
  render();
  toast(editingIsNew ? '已添加：' + editing.name : '已保存：' + editing.name);
}

function deleteEditing() {
  if (!editing || editingIsNew) return;
  if (!confirm('确定删除这个零件？')) return;
  state.rows = state.rows.filter(function (x) { return x.id !== editing.id; });
  state.sel = null;
  $('modal').classList.remove('show');
  save();
  render();
  toast('已删除');
}

/* ---------------- toast ---------------- */
var toastTimer = null;
function toast(text) {
  var t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
}
