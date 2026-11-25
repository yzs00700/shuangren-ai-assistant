'use strict';

/* ============================================================
   BOM 报价 · 导入 / 导出 / 打印 / 事件
   ============================================================ */

var BRIDGE = 'http://127.0.0.1:18766';
var occtReady = null;

function setStatus(html, cls) {
  var el = $('status');
  el.className = 'status' + (cls ? ' ' + cls : '');
  el.innerHTML = html;
  if (cls === 'ok') {
    setTimeout(function () {
      if (el.className.indexOf('ok') >= 0) el.className = 'status';
    }, 6000);
  }
}

function getOcct() {
  if (!occtReady) {
    if (!window.occtimportjs) {
      return Promise.reject(new Error('CAD 内核脚本未加载（app/vendor/occt-import-js.js 缺失）'));
    }
    occtReady = window.occtimportjs({});
  }
  return occtReady;
}

/* 三角面 → 体积 mm³ */
function meshVolume(mesh) {
  var pos = mesh.attributes.position.array;
  var idx = mesh.index && mesh.index.array ? mesh.index.array : null;
  var vol = 0;
  var n = idx ? idx.length : pos.length / 3;
  for (var i = 0; i < n; i += 3) {
    var i0 = (idx ? idx[i] : i) * 3;
    var i1 = (idx ? idx[i + 1] : i + 1) * 3;
    var i2 = (idx ? idx[i + 2] : i + 2) * 3;
    var ax = pos[i0], ay = pos[i0 + 1], az = pos[i0 + 2];
    var bx = pos[i1], by = pos[i1 + 1], bz = pos[i1 + 2];
    var cx = pos[i2], cy = pos[i2 + 1], cz = pos[i2 + 2];
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) +
      az * (bx * cy - by * cx)) / 6;
  }
  return Math.abs(vol);
}

function niceMeshName(raw, i) {
  var s = (raw === undefined || raw === null) ? '' : String(raw).trim();
  var bad = !s || /^[0-9]+$/.test(s) || s.length > 40 ||
    /cascade|translator|step file|iges|brep|open cascade/i.test(s);
  return bad ? ('实体 ' + (i + 1)) : s;
}

function applyMeshes(meshes, fileName) {
  var added = 0;
  (meshes || []).forEach(function (m, i) {
    if (!m || !m.attributes || !m.attributes.position) return;
    var volCm3 = meshVolume(m) / 1000;
    if (!(volCm3 > 1e-6)) return;
    var r = newRow('plastic');
    r.name = niceMeshName(m.name, i);
    r.spec = 'STEP 导入' + (fileName ? ' · ' + fileName : '');
    r.p.volumeCm3 = Math.round(volCm3 * 1000) / 1000;
    r.remark = '体积由三角面近似积分，曲面误差通常 <1%';
    state.rows.push(r);
    added++;
  });
  if (!added) {
    setStatus('解析完成，但没有读到有效实体（文件可能只有曲面或为空）', 'err');
    return;
  }
  state.sel = null;
  save();
  render();
  setStatus('STEP 解析完成：新增 ' + added + ' 个零件，已按塑料件填入体积，可逐个改品类和材料。', 'ok');
  toast('已导入 ' + added + ' 个实体');
}

function handleCadBuffer(buf, fileName) {
  setStatus('<span class="spinner"></span>正在解析（首次使用需加载 7MB CAD 内核，大装配体可能要几秒）…', 'info');
  var t0 = performance.now();
  getOcct().then(function (inst) {
    var lower = (fileName || '').toLowerCase();
    var res;
    if (/\.(igs|iges)$/.test(lower)) {
      res = inst.ReadIgesFile(buf, null);
    } else if (/\.brep$/.test(lower)) {
      res = inst.ReadBrepFile(buf, null);
    } else {
      res = inst.ReadStepFile(buf, null);
    }
    if (!res || !res.success || !res.meshes || !res.meshes.length) {
      setStatus('这个文件里没读到实体（可能是曲面片、装配外壳或不完整文件）', 'err');
      return;
    }
    applyMeshes(res.meshes, fileName);
    var secs = ((performance.now() - t0) / 1000).toFixed(1);
    setStatus('STEP 解析完成：' + res.meshes.length + ' 个实体，用时 ' + secs +
      ' 秒。已加入 BOM，可逐个调整品类和材料。', 'ok');
  }).catch(function (err) {
    console.error(err);
    setStatus('解析失败：' + (err && err.message ? err.message : err), 'err');
  });
}

function handleCadFile(file) {
  if (!file) return;
  var nm = file.name.toLowerCase();
  if (!/\.(stp|step|igs|iges|brep)$/.test(nm)) {
    setStatus('只支持 .stp / .step / .igs / .iges / .brep；STL 这类网格文件没有实体体积。', 'err');
    return;
  }
  var reader = new FileReader();
  reader.onload = function () {
    handleCadBuffer(new Uint8Array(reader.result), file.name);
  };
  reader.onerror = function () { setStatus('读取文件失败', 'err'); };
  reader.readAsArrayBuffer(file);
}

/* ---------------- 从 Creo 装配导入 ---------------- */
function guessCat(name, file) {
  var s = ((name || '') + ' ' + (file || '')).toLowerCase();
  if (/screw|bolt|nut|washer|rivet|螺丝|螺钉|螺母|垫圈|铆钉|销/.test(s)) return 'fastener';
  if (/pcb|board|sensor|motor|switch|relay|fan|电源|电控|传感器|电机|开关|继电器|风扇/.test(s)) return 'electric';
  if (/cable|wire|harness|线束|电缆|导线|线材/.test(s)) return 'wire';
  if (/sheet|plate|bracket|cover|panel|钣金|支架|盖板|面板|安装板/.test(s)) return 'sheet';
  if (/cast|压铸|铸/.test(s)) return 'diecast';
  if (/cnc|机加|加工件/.test(s)) return 'cnc';
  return 'other';
}

function importFromCreo() {
  setStatus('<span class="spinner"></span>正在读取当前 Creo 装配…', 'info');
  var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 30000) : null;
  fetch(BRIDGE + '/assembly/info', { signal: ctrl ? ctrl.signal : undefined })
    .then(function (res) { return res.text().then(function (t) { return { res: res, text: t }; }); })
    .then(function (o) {
      if (timer) clearTimeout(timer);
      var d = null;
      try { d = JSON.parse(o.text); } catch (e) { }
      if (!o.res.ok || !d || d.ok === false) {
        throw new Error((d && (d.error || d.message)) || ('HTTP ' + o.res.status));
      }
      if (!d.items || !d.items.length) {
        setStatus('当前装配里没有组件。请先在 Creo 打开一个装配体。', 'err');
        return;
      }
      var groups = {};
      d.items.forEach(function (it) {
        var key = (it.file || it.name || '').toLowerCase();
        if (!key) return;
        if (!groups[key]) {
          groups[key] = { name: it.name || it.file, file: it.file || '', qty: 0 };
        }
        groups[key].qty++;
      });
      var added = 0;
      Object.keys(groups).forEach(function (k) {
        var g = groups[k];
        var r = newRow(guessCat(g.name, g.file));
        r.name = g.name.replace(/\.(prt|asm)(\.\d+)?$/i, '');
        r.spec = g.file ? g.file.replace(/\.(prt|asm)(\.\d+)?$/i, '') : 'Creo 装配';
        r.qty = g.qty;
        r.remark = '从 Creo 装配导入：' + (d.model || '');
        state.rows.push(r);
        added++;
      });
      save();
      render();
      setStatus('已从 Creo 导入 ' + added + ' 项（按文件合并数量，共 ' +
        d.items.length + ' 个组件）。品类和重量请按实际填写。', 'ok');
      toast('已导入 ' + added + ' 项');
    })
    .catch(function (err) {
      if (timer) clearTimeout(timer);
      setStatus('读取 Creo 装配失败：' + (err && err.message ? err.message : err) +
        '。请确认 Creo 已打开装配体，且 CreoBridge 正在运行。', 'err');
    });
}

/* ---------------- 导出 ---------------- */
function download(fileName, content, mime) {
  var blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 400);
}

function csvCell(v) {
  var s = String(v === undefined || v === null ? '' : v);
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function ymdDate(d) {
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}

function quoteInit() {
  var p = state.project;
  var m = state.bomMeta || {};
  if (!p.date) p.date = today();
  if (!p.quoteNo) p.quoteNo = 'BJ-' + String(p.date).replace(/-/g, '') + '-001';
  if (!p.quoteName) p.quoteName = (p.name ? p.name + ' ' : '') + '产品报价单';
  if (!p.validUntil) {
    var d = new Date(String(p.date).replace(/-/g, '/'));
    if (isNaN(d.getTime())) d = new Date();
    d.setDate(d.getDate() + 30);
    p.validUntil = ymdDate(d);
  }
  if (!p.version) p.version = 'A';
  if (!p.preparedBy) p.preparedBy = m.preparedBy || '';
  if (!p.reviewedBy) p.reviewedBy = m.reviewedBy || '';
}

function syncQuoteStamp() {
  var p = state.project;
  var vs = $('quoteVersionShow'); if (vs) vs.textContent = p.version || 'A';
  var ds = $('quoteDateShow'); if (ds) ds.textContent = p.date || '—';
  var cs = $('quoteCurShow'); if (cs) cs.textContent = p.currency || 'CNY';
}

function syncQuoteHeaderFromState() {
  var p = state.project, m = state.bomMeta || {};
  var set = function (id, v) {
    var el = $(id);
    if (el) el.value = v === undefined || v === null ? '' : v;
  };
  set('quoteCompany', m.company || '');
  set('quoteDocName', p.quoteName || '');
  set('quoteCustomer', p.customer || '');
  set('quoteProject', p.name || '');
  set('quoteNo', p.quoteNo || '');
  set('quoteDate', p.date || '');
  set('quoteValid', p.validUntil || '');
  set('quotePreparedBy', p.preparedBy || '');
  set('quoteReviewedBy', p.reviewedBy || '');
  set('quoteVersion', p.version || 'A');
  var img = $('quoteLogo');
  if (img) img.src = m.logo || 'logo.png';
  syncQuoteStamp();
}

function bindQuoteHeader() {
  var pick = $('quoteLogoPick');
  if (pick) {
    pick.onclick = function (e) {
      e.preventDefault();
      if ($('bomLogoFile')) $('bomLogoFile').click();
    };
  }
  function on(id, handler) {
    var el = $(id);
    if (!el) return;
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
  }
  on('quoteCompany', function () {
    state.bomMeta.company = this.value;
    var b = $('bomCompany'); if (b) b.value = this.value;
    save();
  });
  on('quoteDocName', function () { state.project.quoteName = this.value; save(); });
  on('quoteCustomer', function () {
    state.project.customer = this.value;
    if ($('projCustomer')) $('projCustomer').value = this.value;
    save(); renderSummary();
  });
  on('quoteProject', function () {
    state.project.name = this.value;
    if ($('projName')) $('projName').value = this.value;
    save(); renderSummary();
  });
  on('quoteNo', function () { state.project.quoteNo = this.value; save(); });
  on('quoteDate', function () {
    state.project.date = this.value;
    if ($('projDate')) $('projDate').value = this.value;
    save(); syncQuoteStamp();
  });
  on('quoteValid', function () { state.project.validUntil = this.value; save(); });
  on('quotePreparedBy', function () { state.project.preparedBy = this.value; save(); });
  on('quoteReviewedBy', function () { state.project.reviewedBy = this.value; save(); });
  on('quoteVersion', function () {
    state.project.version = this.value;
    save(); syncQuoteStamp();
  });
}

function loadDocLogo(cb) {
  var logo = (state.bomMeta && state.bomMeta.logo) || '';
  if (logo) { cb(logo); return; }
  try {
    fetch('logo.png').then(function (r) { return r.blob(); }).then(function (b) {
      var fr = new FileReader();
      fr.onload = function () { cb(String(fr.result || '')); };
      fr.onerror = function () { cb(''); };
      fr.readAsDataURL(b);
    }).catch(function () { cb(''); });
  } catch (e) { cb(''); }
}

function exportQuoteExcel() {
  if (!state.rows.length) { toast('还没有零件'); return; }
  quoteInit();
  syncQuoteHeaderFromState();
  loadDocLogo(function (logo) {
    var t = totals();
    var p = state.project;
    var m = state.bomMeta || {};
    var cur = (CUR[p.currency] || CUR.CNY).name;

    var body = state.rows.map(function (r, i) {
      var c = calcRow(r);
      return '<tr class="itemrow">' +
        '<td class="c">' + (i + 1) + '</td>' +
        '<td class="c">' + esc(CATMAP[r.cat].name) + '</td>' +
        '<td class="l">' + esc(r.name || '') + '</td>' +
        '<td class="l">' + esc(r.spec || '') + '</td>' +
        '<td class="c">' + num(r.qty) + '</td>' +
        '<td class="c">' + esc(r.unit || '件') + '</td>' +
        '<td class="n">' + (c.weight ? c.weight.toFixed(3) : '') + '</td>' +
        '<td class="n">' + c.mat.toFixed(2) + '</td>' +
        '<td class="n">' + c.proc.toFixed(2) + '</td>' +
        '<td class="n">' + c.surf.toFixed(2) + '</td>' +
        '<td class="n">' + c.mold.toFixed(2) + '</td>' +
        '<td class="n">' + c.buy.toFixed(2) + '</td>' +
        '<td class="n">' + c.loss.toFixed(2) + '</td>' +
        '<td class="n">' + c.unit.toFixed(2) + '</td>' +
        '<td class="n">' + c.total.toFixed(2) + '</td>' +
        '<td class="l">' + esc(r.remark || '') + '</td>' +
        '</tr>';
    }).join('');

    var revs = (m.revisions || []).slice();
    if (!revs.length) {
      revs.push({
        version: p.version || 'A', date: p.date || '',
        content: '首次报价', prepared: p.preparedBy || '',
        reviewed: p.reviewedBy || ''
      });
    }
    var revHtml = revs.map(function (r) {
      return '<tr><td colspan="2" class="c">' + esc(r.version || '') + '</td>' +
        '<td colspan="2" class="c">' + esc(r.date || '') + '</td>' +
        '<td colspan="8" class="l">' + esc(r.content || '版本更新') + '</td>' +
        '<td colspan="2" class="c">' + esc(r.prepared || '') + '</td>' +
        '<td colspan="2" class="c">' + esc(r.reviewed || '') + '</td></tr>';
    }).join('');

    var logoCell = logo
      ? '<td colspan="2" rowspan="4" class="logo"><img src="' + logo +
        '" width="72" height="72" style="width:72px;height:72px" alt="LOGO"></td>'
      : '<td colspan="2" rowspan="4" class="logo">LOGO</td>';

    var html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" ' +
      'xmlns:x="urn:schemas-microsoft-com:office:excel" ' +
      'xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8">' +
      '<title>' + esc(p.quoteName || '产品报价单') + '</title>' +
      '<style>' +
      '@page{size:A4 landscape;margin:8mm;mso-page-orientation:landscape}' +
      'body{font-family:"Microsoft YaHei","SimSun";font-size:8pt;color:#111;margin:0}' +
      'table.doc{width:100%;border-collapse:collapse;table-layout:fixed}' +
      'table.doc td,table.doc th{border:1px solid #333;padding:2pt 3pt;' +
      'font-size:8pt;vertical-align:middle;word-wrap:break-word;overflow:hidden}' +
      '.logo{text-align:center;font-weight:bold;color:#888;padding:0!important}' +
      '.logo img{display:block;margin:0 auto}' +
      'table.doc td.company{font-size:14pt;font-weight:bold;text-align:center}' +
      'table.doc td.title{font-size:16pt;font-weight:bold;text-align:center}' +
      'table.doc td.lbl{background:#f2f2f2;font-weight:bold;text-align:center;font-size:7.5pt}' +
      '.v{padding-left:6px}' +
      'table.doc tr.cols th{background:#d9e2f3;font-weight:bold;text-align:center;' +
      'height:22pt;font-size:7.5pt}' +
      '.c{text-align:center}.l{text-align:left}' +
      '.n{text-align:right;mso-number-format:"0.00"}' +
      '.itemrow td{height:14pt}' +
      'table.doc tr.total td{background:#f2f2f2;font-weight:bold}' +
      'table.doc td.sumlbl{background:#f2f2f2;font-weight:bold;text-align:right}' +
      'table.doc tr.grand td{background:#1e40af;color:#fff;font-weight:bold;font-size:9pt}' +
      'table.doc td.terms{border:none;padding:2pt 4pt;font-size:7.5pt;' +
      'line-height:1.5;text-align:left}' +
      'table.doc td.noborder{border:none;background:transparent!important;color:inherit!important}' +
      'table.doc td.sec{background:#d9e2f3;font-weight:bold;text-align:center;' +
      'font-size:8.5pt;height:18pt}' +
      'table.doc tr.revhead th{background:#f2f2f2;font-weight:bold;text-align:center;font-size:7.5pt}' +
      'table.doc tr.sign td{border:none;border-top:1px solid #333;padding:6pt 4pt;' +
      'text-align:left;font-size:7.5pt}' +
      '</style></head><body>' +
      '<table class="doc">' +
      '<colgroup>' +
      '<col width="36" style="width:27pt"><col width="52" style="width:39pt">' +
      '<col width="170" style="width:127.5pt"><col width="125" style="width:93.75pt">' +
      '<col width="42" style="width:31.5pt"><col width="38" style="width:28.5pt">' +
      '<col width="52" style="width:39pt"><col width="56" style="width:42pt">' +
      '<col width="56" style="width:42pt"><col width="56" style="width:42pt">' +
      '<col width="56" style="width:42pt"><col width="50" style="width:37.5pt">' +
      '<col width="44" style="width:33pt"><col width="60" style="width:45pt">' +
      '<col width="68" style="width:51pt"><col width="80" style="width:60pt">' +
      '</colgroup>' +
      '<tr>' + logoCell +
        '<td colspan="6" class="company">' + esc(m.company || '公司名称') + '</td>' +
        '<td colspan="8" class="title">' + esc(p.quoteName || '产品报价单') + '</td></tr>' +
      '<tr><td class="lbl">报价单号</td>' +
        '<td colspan="3" class="v">' + esc(p.quoteNo || '') + '</td>' +
        '<td colspan="2" class="lbl">报价日期</td>' +
        '<td colspan="4" class="v">' + esc(p.date || '') + '</td>' +
        '<td colspan="2" class="lbl">版本</td>' +
        '<td colspan="2" class="v">' + esc(p.version || 'A') + '</td></tr>' +
      '<tr><td class="lbl">客户</td>' +
        '<td colspan="3" class="v">' + esc(p.customer || '') + '</td>' +
        '<td colspan="3" class="lbl">项目名称</td>' +
        '<td colspan="7" class="v">' + esc(p.name || '') + '</td></tr>' +
      '<tr><td class="lbl">有效期至</td>' +
        '<td colspan="3" class="v">' + esc(p.validUntil || '') + '</td>' +
        '<td colspan="3" class="lbl">币种</td>' +
        '<td colspan="7" class="v">' + esc(cur) + '</td></tr>' +
      '<tr class="cols">' +
        '<th>序号</th><th>品类</th><th>名称</th><th>规格 / 材料</th>' +
        '<th>数量</th><th>单位</th><th>单重(g)</th><th>材料费</th>' +
        '<th>加工费</th><th>表面处理</th><th>模具摊销</th><th>外购费</th>' +
        '<th>损耗</th><th>单价</th><th>小计</th><th>备注</th></tr>' +
      body +
      '<tr class="total"><td colspan="4" class="l">合计</td>' +
        '<td class="c">' + t.qty + '</td><td></td>' +
        '<td class="n">' + (t.weight / 1000).toFixed(3) + '</td>' +
        '<td class="n">' + t.mat.toFixed(2) + '</td>' +
        '<td class="n">' + t.proc.toFixed(2) + '</td>' +
        '<td class="n">' + t.surf.toFixed(2) + '</td>' +
        '<td class="n">' + t.mold.toFixed(2) + '</td>' +
        '<td class="n">' + t.buy.toFixed(2) + '</td>' +
        '<td class="n">' + t.loss.toFixed(2) + '</td>' +
        '<td></td><td class="n">' + t.subtotal.toFixed(2) + '</td><td></td></tr>' +
      '<tr><td colspan="11" class="noborder"></td><td colspan="2" class="sumlbl">未税小计</td>' +
        '<td colspan="2" class="n">' + t.subtotal.toFixed(2) + '</td><td class="noborder"></td></tr>' +
      '<tr><td colspan="11" class="noborder"></td><td colspan="2" class="sumlbl">管理费</td>' +
        '<td colspan="2" class="n">' + t.mgmt.toFixed(2) + '</td><td class="noborder"></td></tr>' +
      '<tr><td colspan="11" class="noborder"></td><td colspan="2" class="sumlbl">利润</td>' +
        '<td colspan="2" class="n">' + t.profit.toFixed(2) + '</td><td class="noborder"></td></tr>' +
      '<tr><td colspan="11" class="noborder"></td><td colspan="2" class="sumlbl">运费 / 其他</td>' +
        '<td colspan="2" class="n">' + t.extra.toFixed(2) + '</td><td class="noborder"></td></tr>' +
      '<tr><td colspan="11" class="noborder"></td><td colspan="2" class="sumlbl">税</td>' +
        '<td colspan="2" class="n">' + t.tax.toFixed(2) + '</td><td class="noborder"></td></tr>' +
      '<tr class="grand"><td colspan="11" class="noborder"></td><td colspan="2">含税总价</td>' +
        '<td colspan="2" class="n">' + t.grand.toFixed(2) + ' ' + esc(cur) + '</td><td class="noborder"></td></tr>' +
      '<tr><td colspan="16" class="terms"><b>报价说明</b></td></tr>' +
      '<tr><td colspan="16" class="terms">1. 本报价按当前材料价、工艺费和 ' +
      esc(regionInfo().name) + ' 地区费率估算，最终以实际图纸、样品和合同为准。</td></tr>' +
      '<tr><td colspan="16" class="terms">2. 报价有效期至 ' +
      esc(p.validUntil || '—') + '，逾期请重新确认材料与人工价格。</td></tr>' +
      '<tr><td colspan="16" class="terms">3. 币种：' + esc(cur) +
      '；税率 ' + num(state.rates.tax) + '%；运费及其他费用按实际结算。</td></tr>' +
      '<tr><td colspan="16" class="terms">4. 模具费按摊销数量分摊，未达到约定数量时模具费需另行计算。</td></tr>' +
      '<tr><td colspan="16" class="terms">5. 交期、包装、运输方式及付款条件另议。</td></tr>' +
      '<tr><td colspan="16" class="sec">产品 BOM 修订记录（供参考）</td></tr>' +
      '<tr class="revhead"><th colspan="2">版本</th><th colspan="2">日期</th>' +
        '<th colspan="8">修改内容</th><th colspan="2">编制</th>' +
        '<th colspan="2">审核</th></tr>' +
      revHtml +
      '<tr class="sign"><td colspan="4">编制：' + esc(p.preparedBy || '') + '</td>' +
        '<td colspan="4">审核：' + esc(p.reviewedBy || '') + '</td>' +
        '<td colspan="4">客户确认：</td>' +
        '<td colspan="4">日期：' + esc(p.date || '') + '</td></tr>' +
      '</table></body></html>';

    var d = new Date();
    var stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0') + '_' + String(d.getHours()).padStart(2, '0') +
      String(d.getMinutes()).padStart(2, '0');
    var name = String(p.quoteName || '产品报价单').replace(/[\\/:*?"<>|]/g, '_');
    download('报价单_' + name + '_' + stamp + '.xls', '\ufeff' + html,
      'application/vnd.ms-excel;charset=utf-8');
    toast('Excel 报价单已导出');
  });
}

function exportCsv() { exportQuoteExcel(); }

function exportJson() {
  var data = {
    app: '霜刃AI助手 BOM 报价',
    version: 1,
    exportedAt: new Date().toISOString(),
    regionName: regionInfo().name,
    project: state.project,
    rates: state.rates,
    rows: state.rows,
    totals: totals()
  };
  var d = new Date();
  var stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0') + '_' + String(d.getHours()).padStart(2, '0') +
    String(d.getMinutes()).padStart(2, '0');
  download('BOM_报价_' + stamp + '.json', JSON.stringify(data, null, 2),
    'application/json;charset=utf-8');
  toast('JSON 已导出');
}

/* ---------------- 打印 ---------------- */
function updatePrintHead() {
  var el = $('printhead');
  if (!el) {
    el = document.createElement('div');
    el.id = 'printhead';
    el.className = 'printhead';
    var main = document.querySelector('main');
    main.insertBefore(el, main.firstChild);
  }
  var t = totals();
  var p = state.project;
  el.innerHTML =
    '<div style="font-size:15px;font-weight:700">BOM 报价单' +
    (p.name ? ' · ' + esc(p.name) : '') + '</div>' +
    '<div>客户：' + esc(p.customer || '—') + '　日期：' + esc(p.date || today()) +
    '　币种：' + esc((CUR[p.currency] || CUR.CNY).name) +
    '　地区：' + esc(regionInfo().name) + '</div>' +
    '<div>零件项数：' + t.items + '　总数量：' + t.qty +
    '　含税总价：<b>' + money(t.grand) + '</b></div>';
}

function printQuote() {
  updatePrintHead();
  setTimeout(function () { window.print(); }, 80);
}

/* ---------------- 地区费率 / 网价 ---------------- */
function applyAllRates() {
  state.rows.forEach(function (r) {
    if (typeof applyRatesToRow === 'function') applyRatesToRow(r, true);
  });
}

function renderMarketInfo() {
  var el = $('marketInfo');
  var status = $('rMarketStatus');
  var m = state.rates.market || {};
  var n = Object.keys(m).length;
  var at = state.rates.marketAt || '';
  var text, title;
  if (!n) {
    text = '网价未同步 · 使用参考价';
    title = '点击“同步网价”从新浪财经获取铝/铜/钢/塑料期货价格';
  } else {
    text = '网价 ' + (at ? at.slice(5, 16) : '已缓存') + ' · ' + n + ' 个品种';
    title = '来源：' + (state.rates.marketSource || '新浪财经期货') +
      (at ? '\n更新时间：' + at : '') + '\n' +
      Object.keys(m).map(function (k) { return k + ' ' + m[k]; }).join('  ');
  }
  if (el) {
    el.textContent = text;
    el.title = title;
    el.classList.toggle('warn', !n);
  }
  if (status) status.value = text;
}

function setRegion(id) {
  state.rates.region = regionById(id).id;
  applyAllRates();
  save();
  render();
  renderMarketInfo();
  var r = regionInfo();
  toast('已切换到 ' + r.name + '：材料 / 加工 / 表面处理已按地区系数更新');
}

function syncMarket(silent) {
  var btn = $('btnMarket');
  if (btn && !silent) {
    btn.disabled = true;
    btn.textContent = '同步中…';
  }
  if (!silent && $('marketInfo')) $('marketInfo').textContent = '正在同步网价…';

  return fetch(BRIDGE + '/market/prices?refresh=1', { cache: 'no-store' })
    .then(function (res) {
      return res.text().then(function (t) { return { res: res, text: t }; });
    })
    .then(function (o) {
      var d = null;
      try { d = JSON.parse(o.text); } catch (e) { }
      if (!d || d.ok === false) {
        throw new Error((d && (d.error || d.warning)) || ('HTTP ' + o.res.status));
      }
      state.rates.market = d.prices || {};
      state.rates.marketAt = d.fetchedAt || '';
      state.rates.marketSource = d.source || '新浪财经期货';
      applyAllRates();
      save();
      render();
      renderMarketInfo();
      if (!silent) {
        toast('网价已同步：' + (d.count || 0) + ' 个品种' +
          (d.cached ? '（缓存）' : '') + (d.warning ? '；' + d.warning : ''));
      }
      return d;
    })
    .then(function (d) {
      if (btn && !silent) {
        btn.disabled = false;
        btn.textContent = '同步网价';
      }
      return d;
    }, function (err) {
      if (btn && !silent) {
        btn.disabled = false;
        btn.textContent = '同步网价';
      }
      renderMarketInfo();
      if (!silent) toast('网价同步失败：' + (err && err.message ? err.message : err));
      throw err;
    });
}

function rateRegion() {
  return regionById($('rRegion').value || state.rates.region);
}

function renderRateOverrides() {
  var reg = rateRegion();

  var html = '';
  CATS.forEach(function (c) {
    var list = materialList(c.id);
    if (!list.length) return;
    html += '<div class="grp">' + esc(c.name) + '</div>';
    list.forEach(function (m) {
      var key = c.id + ':' + m.key;
      var ov = rateOverride('material', key);
      var auto = baseMaterialPrice(c.id, m.key) * reg.material;
      html += '<label><span>' + esc(m.name) + '</span>' +
        '<input type="number" min="0" step="0.1" data-ov="' + key +
        '" value="' + (ov === null ? '' : ov) + '" placeholder="' + auto.toFixed(2) +
        '" title="自动参考价 ' + auto.toFixed(2) + ' 元/kg"></label>';
    });
  });
  $('rMaterials').innerHTML = html;

  html = '';
  PROCESSES.forEach(function (p) {
    var ov = rateOverride('process', p.key);
    var auto = p.base * reg.labor;
    html += '<label><span>' + esc(p.name) + '</span>' +
      '<input type="number" min="0" step="0.1" data-ov="' + p.key +
      '" value="' + (ov === null ? '' : ov) + '" placeholder="' + auto.toFixed(2) +
      '" title="自动参考价 ' + auto.toFixed(2) + ' ' + p.unit + '"></label>';
  });
  $('rProcesses').innerHTML = html;

  html = '';
  SURFACES.forEach(function (s) {
    var ov = rateOverride('surface', s.key);
    var auto = s.price * reg.labor;
    html += '<label><span>' + esc(s.name) + '</span>' +
      '<input type="number" min="0" step="0.1" data-ov="' + s.key +
      '" value="' + (ov === null ? '' : ov) + '" placeholder="' + auto.toFixed(2) +
      '" title="自动参考价 ' + auto.toFixed(2) + ' 元/件"></label>';
  });
  $('rSurfaces').innerHTML = html;
}

function readOverrides(containerId) {
  var bag = {};
  document.querySelectorAll('#' + containerId + ' input[data-ov]').forEach(function (inp) {
    var v = inp.value.trim();
    if (v === '') return;
    var n = num(v);
    if (isFinite(n) && n >= 0) bag[inp.dataset.ov] = n;
  });
  return bag;
}

function collectRateOverrides() {
  state.rates.materialOverrides = readOverrides('rMaterials');
  state.rates.processOverrides = readOverrides('rProcesses');
  state.rates.surfaceOverrides = readOverrides('rSurfaces');
}

function openRates() {
  $('rMgmt').value = state.rates.mgmt;
  $('rProfit').value = state.rates.profit;
  $('rTax').value = state.rates.tax;
  $('rFreight').value = state.rates.freight;
  $('rOther').value = state.rates.other;
  $('rRegion').innerHTML = REGIONS.map(function (r) {
    return '<option value="' + r.id + '">' + r.name + '</option>';
  }).join('');
  $('rRegion').value = state.rates.region || 'east';
  renderRateOverrides();
  renderMarketInfo();
  $('rateModal').classList.add('show');
}

function saveRates() {
  var before = JSON.stringify({
    region: state.rates.region,
    m: state.rates.materialOverrides,
    p: state.rates.processOverrides,
    s: state.rates.surfaceOverrides
  });

  state.rates.mgmt = num($('rMgmt').value);
  state.rates.profit = num($('rProfit').value);
  state.rates.tax = num($('rTax').value);
  state.rates.freight = num($('rFreight').value);
  state.rates.other = num($('rOther').value);
  state.rates.region = regionById($('rRegion').value).id;
  collectRateOverrides();

  var after = JSON.stringify({
    region: state.rates.region,
    m: state.rates.materialOverrides,
    p: state.rates.processOverrides,
    s: state.rates.surfaceOverrides
  });
  if (before !== after) applyAllRates();

  $('rateModal').classList.remove('show');
  save();
  render();
  renderMarketInfo();
  toast('费率已保存');
}

function resetRates() {
  if (!confirm('恢复默认地区（华东）、默认全局费率和自动参考价？所有手工覆盖会清除。')) return;
  state.rates.mgmt = 8;
  state.rates.profit = 12;
  state.rates.tax = 13;
  state.rates.freight = 0;
  state.rates.other = 0;
  state.rates.region = 'east';
  state.rates.materialOverrides = {};
  state.rates.processOverrides = {};
  state.rates.surfaceOverrides = {};
  applyAllRates();
  save();
  render();
  openRates();
  toast('已恢复默认费率');
}

/* ---------------- 示例数据 ---------------- */
function seedDemo() {
  var demo = [
    ['plastic', 'ABS 外壳', 'ABS 黑色 120×80×25', 1,
      { volumeCm3: 85, density: 1.05, matPrice: 12.8, machineRate: 45, cycleSec: 28, cavities: 2, moldCost: 35000, moldQty: 20000 },
      'none'],
    ['sheet', '安装底板', 'Q235 冷轧板 1.5mm', 2,
      { areaM2: 0.08, thicknessMm: 1.5, density: 7.85, matPrice: 6.2, laserCost: 2.5, bends: 4, bendCost: 0.8, weldCost: 0, surfaceCost: 3, moldCost: 0, moldQty: 1000 },
      'powder'],
    ['profile', '3030 型材立柱', '3030 标准型材 L=1000', 4,
      { lengthM: 1.0, weightPerM: 0.9, matPrice: 25, cutCost: 1.5, machineCost: 0, surfaceCost: 0 },
      'anodize'],
    ['diecast', '铸铁支座', 'HT200 砂型铸造', 2,
      { volumeCm3: 120, density: 7.25, matPrice: 6.5, machineRate: 35, cycleSec: 300, cavities: 1, deburrCost: 1.2, surfaceCost: 0, moldCost: 800, moldQty: 500, castingMethod: 'sand' },
      'paint', 'HT200'],
    ['cnc', '铝连接块', '6061-T6', 4,
      { blankVolumeCm3: 65, density: 2.7, matPrice: 28, machineRate: 85, hours: 0.35, programCost: 300, batchQty: 50, surfaceCost: 2 },
      'anodize'],
    ['fastener', 'M4×12 内六角螺钉', '304 不锈钢', 24,
      { purchasePrice: 0.12, surfaceCost: 0 }, 'none'],
    ['wire', '电源线束', '2×0.75mm² L=1.2m', 1,
      { lengthM: 1.2, weightPerM: 0.025, pricePerM: 2.8, terminals: 4, terminalPrice: 0.15, laborCost: 1.2 }, 'none'],
    ['electric', '开关电源', '24V 5A', 1,
      { purchasePrice: 38, testCost: 1.5, harnessCost: 0 }, 'none']
  ];
  demo.forEach(function (d) {
    var r = newRow(d[0]);
    r.name = d[1];
    r.spec = d[2];
    r.qty = d[3];
    r.surfaceKey = d[5] || 'none';
    if (d[6]) r.matKey = d[6];
    Object.assign(r.p, d[4]);
    // 示例也走地区费率库，切换地区/同步网价时能直接看到变化。
    if (typeof applyRatesToRow === 'function') applyRatesToRow(r, true);
    r.remark = '示例数据，可直接修改';
    state.rows.push(r);
  });
  save();
  render();
  toast('已载入示例，可逐项修改');
}

/* ---------------- 事件绑定 ---------------- */
function syncTopHeight() {
  var h = $('topbar') ? $('topbar').offsetHeight : 58;
  document.documentElement.style.setProperty('--topH', h + 'px');
}

function bindEvents() {
  $('btnAdd').onclick = function () { openEditor(null, 'plastic'); };
  $('region').onchange = function () { setRegion(this.value); };
  $('btnMarket').onclick = function () {
    syncMarket(false).catch(function () { });
  };
  $('btnDemo').onclick = function () {
    if (state.rows.length && !confirm('当前已有零件，仍要追加示例数据？')) return;
    seedDemo();
  };
  $('btnStep').onclick = function () { $('file').click(); };
  $('btnCreo').onclick = importFromCreo;
  $('btnCsv').onclick = exportQuoteExcel;
  $('btnJson').onclick = exportJson;
  $('btnPrint').onclick = printQuote;
  $('btnBack').onclick = function () { location.href = '/app/index.html'; };
  $('btnRates').onclick = openRates;
  $('btnClear').onclick = function () {
    if (!state.rows.length) return;
    if (!confirm('确定清空全部 ' + state.rows.length + ' 项零件？项目信息和费率会保留。')) return;
    state.rows = [];
    state.sel = null;
    save();
    render();
    toast('已清空');
  };

  $('file').onchange = function (e) {
    var f = e.target.files && e.target.files[0];
    handleCadFile(f);
    e.target.value = '';
  };

  document.querySelectorAll('.quick button').forEach(function (b) {
    b.onclick = function () { openEditor(null, b.dataset.cat); };
  });

  $('cats').onclick = function (e) {
    var chip = e.target.closest('.chip');
    if (!chip) return;
    state.filter = chip.dataset.cat;
    renderChips();
    renderRows();
  };

  $('search').oninput = function () {
    state.search = this.value;
    renderRows();
  };

  /* 表格：行点击 / 数量 / 删除 */
  $('rows').onclick = function (e) {
    var del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      var id = del.dataset.del;
      var r = state.rows.find(function (x) { return x.id === id; });
      if (r && confirm('删除“' + (r.name || '未命名') + '”？')) {
        state.rows = state.rows.filter(function (x) { return x.id !== id; });
        if (state.sel === id) state.sel = null;
        save();
        render();
      }
      return;
    }
    if (e.target.classList.contains('qtyin')) return;
    var tr = e.target.closest('tr[data-id]');
    if (tr) openEditor(tr.dataset.id);
  };

  $('rows').onchange = function (e) {
    if (!e.target.classList.contains('qtyin')) return;
    var r = state.rows.find(function (x) { return x.id === e.target.dataset.id; });
    if (!r) return;
    r.qty = Math.max(0, num(e.target.value));
    save();
    render();
  };

  /* 行编辑弹窗 */
  $('dClose').onclick = $('dCancel').onclick = function () {
    $('modal').classList.remove('show');
    state.sel = null;
    renderRows();
  };
  $('dSave').onclick = saveEditor;
  $('dDelete').onclick = deleteEditing;

  $('fCat').onchange = function () {
    collectEditor();
    editing.cat = this.value;
    editing.p = deepCopy(CATMAP[editing.cat].defaults);
    editing.matKey = materialList(editing.cat).length
      ? defaultMatKey(editing.cat) : '';
    editing.surfaceKey = 'none';
    if (typeof applyRatesToRow === 'function') applyRatesToRow(editing, true);
    renderFields();
    updatePreview();
  };

  $('modal').addEventListener('input', function (e) {
    if (e.target.closest('#fields') || e.target.closest('.grid2')) {
      collectEditor();
      updatePreview();
    }
  });

  // 材料 / 表面处理下拉：带出当前地区与网价的参考值。
  $('fields').addEventListener('change', function (e) {
    if (e.target.id === 'fMat') {
      collectEditor();
      var m = materialInfo(editing.cat, editing.matKey);
      if (m) {
        editing.p.density = m.density;
        if (editing.cat === 'profile') editing.p.weightPerM = m.weightPerM || 0;
        editing.p.matPrice = materialPrice(editing.cat, editing.matKey);
      }
      renderFields();
      updatePreview();
    } else if (e.target.id === 'fSurface') {
      collectEditor();
      editing.p.surfaceCost = surfacePrice(editing.surfaceKey);
      renderFields();
      updatePreview();
    } else if (e.target.id === 'fCastMethod') {
      collectEditor();
      editing.p.castingMethod = e.target.value;
      var cm = castingMethodInfo(editing.p.castingMethod);
      if (cm) {
        editing.p.machineRate = processRate(cm.rateKey);
        editing.p.cycleSec = cm.cycleSec;
        editing.p.deburrCost = cm.deburr;
      }
      renderFields();
      updatePreview();
    }
  });

  /* 费率弹窗 */
  $('rClose').onclick = $('rCancel').onclick = function () {
    $('rateModal').classList.remove('show');
  };
  $('rSave').onclick = saveRates;
  $('rReset').onclick = resetRates;
  $('rRegion').onchange = renderRateOverrides;
  $('rApplyAll').onclick = function () {
    state.rates.region = regionById($('rRegion').value).id;
    collectRateOverrides();
    applyAllRates();
    save();
    render();
    renderRateOverrides();
    toast('已按当前地区费率更新全部零件');
  };

  /* 项目信息 */
  ['projName', 'projCustomer', 'projDate', 'currency'].forEach(function (id) {
    $(id).oninput = $(id).onchange = function () {
      state.project.name = $('projName').value;
      state.project.customer = $('projCustomer').value;
      state.project.date = $('projDate').value;
      state.project.currency = $('currency').value;
      save();
      renderSummary();
      if (typeof syncQuoteHeaderFromState === 'function') syncQuoteHeaderFromState();
    };
  });

  /* 拖放 STEP */
  var dragDepth = 0;
  window.addEventListener('dragenter', function (e) {
    if (!e.dataTransfer || !e.dataTransfer.types || e.dataTransfer.types.indexOf('Files') < 0) return;
    dragDepth++;
    document.body.classList.add('dragging');
  });
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('dragleave', function (e) {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) document.body.classList.remove('dragging');
  });
  window.addEventListener('drop', function (e) {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleCadFile(f);
  });

  $('drop').onclick = function () { $('file').click(); };

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      $('modal').classList.remove('show');
      $('rateModal').classList.remove('show');
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if ($('modal').classList.contains('show')) saveEditor();
      else toast('数据已自动保存');
    }
  });

  window.addEventListener('beforeprint', updatePrintHead);
  window.addEventListener('beforeunload', save);
  window.addEventListener('resize', syncTopHeight);
}

/* ---------------- 初始化 ---------------- */
function init() {
  load();
  if (!state.project.date) state.project.date = today();
  $('projName').value = state.project.name || '';
  $('projCustomer').value = state.project.customer || '';
  $('projDate').value = state.project.date || '';
  $('currency').value = state.project.currency || 'CNY';
  $('region').innerHTML = REGIONS.map(function (r) {
    return '<option value="' + r.id + '">' + r.name + '</option>';
  }).join('');
  $('region').value = state.rates.region || 'east';
  quoteInit();
  syncQuoteHeaderFromState();
  bindQuoteHeader();
  save();
  render();
  bindEvents();
  syncTopHeight();
  renderMarketInfo();
  if (/[?&]demo=1/.test(location.search) && !state.rows.length) seedDemo();

  // 打开页面时若网价缓存超过 5 分钟，后台静默刷新一次；失败就用缓存/参考价。
  var last = 0;
  if (state.rates.marketAt) {
    last = Date.parse(state.rates.marketAt.replace(/-/g, '/'));
  }
  if (!last || isNaN(last) || Date.now() - last > 5 * 60 * 1000) {
    syncMarket(true).catch(function () { });
  }
}

init();
