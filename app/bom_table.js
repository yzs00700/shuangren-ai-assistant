'use strict';

/* ============================================================
   产品 BOM 表（复刻 HelloCreo 产品BOM表）
   数据保存在 state.bomRows，随 BOM 报价一起存 localStorage。
   ============================================================ */
(function () {
  // Thumbnails are session-only: the bridge reads the JPEG preview embedded
  // in each .prt/.asm, so nothing extra is written next to the models.
  var bomThumbs = {};
  var bomThumbDir = '';
  var bomSel = null;       // {r1,c1,r2,c2} in #bomRows
  var bomAnchor = null;    // {r,c} for shift-click
  var bomFillDrag = null;  // source range while dragging fill handle
  var bomUndo = [];
  var bomRedo = [];
  var bomEditSnap = null;
  var bomEditPushed = false;
  var bomPicked = {};      // id -> true, checkbox selection for batch actions

  function $(id) { return document.getElementById(id); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function uid() {
    return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function notify(msg) {
    if (typeof toast === 'function') { toast(msg); return; }
    setStatus(msg, '');
  }
  function setStatus(text, cls) {
    var el = $('bomStatus');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'status' + (cls ? ' ' + cls : '');
  }

  function ensure() {
    if (!Array.isArray(state.bomRows)) state.bomRows = [];
    if (!state.bomMeta || typeof state.bomMeta !== 'object') {
      state.bomMeta = { template: '常用（默认）' };
    }
    var today = new Date().toISOString().slice(0, 10);
    var meta = state.bomMeta;
    if (meta.docName === undefined) meta.docName = '产品 BOM';
    if (meta.productName === undefined) meta.productName = '';
    if (meta.productModel === undefined) meta.productModel = '';
    if (meta.company === undefined) meta.company = '';
    if (meta.preparedBy === undefined) meta.preparedBy = '';
    if (meta.checkedBy === undefined) meta.checkedBy = '';
    if (meta.reviewedBy === undefined) meta.reviewedBy = '';
    if (meta.version === undefined || meta.version === '') meta.version = 'A';
    if (!meta.preparedDate) meta.preparedDate = today;
    if (!meta.modifiedDate) meta.modifiedDate = today;
    if (!Array.isArray(meta.revisions)) meta.revisions = [];
    if (meta.logo === undefined) meta.logo = '';
    state.bomRows.forEach(function (r) {
      if (!r.id) r.id = uid();
      // manual rows are created by the user and survive a Creo re-import;
      // locked rows are protected from edits, deletion and re-imports.
      r.manual = !!r.manual;
      r.locked = !!r.locked;
      if (r.level === undefined || r.level === null || r.level === '') r.level = '0';
      r.level = String(r.level);
      if (!r.kind) r.kind = '零件';
      if (r.name === undefined) r.name = '';
      if (r.material === undefined) r.material = '';
      if (r.surface === undefined || r.surface === '') r.surface = 'none';
      if (r.color === undefined) r.color = '';
      if (r.finish === undefined || r.finish === '') r.finish = 'none';
      r.qty = num(r.qty) || 1;
      r.unitWeight = num(r.unitWeight);
      r.drawn = String(r.drawn || 'N').toUpperCase().charAt(0) === 'Y' ? 'Y' : 'N';
      if (r.outline === undefined) r.outline = '';
      if (r.remark === undefined) r.remark = '';
    });
  }

  function saveBom() {
    try { if (typeof save === 'function') save(); } catch (e) { }
  }

  function bomSnapshot() {
    return JSON.stringify({
      rows: state.bomRows || [],
      meta: state.bomMeta || {}
    });
  }

  function updateBomHistoryButtons() {
    var u = $('bomUndo');
    var r = $('bomRedo');
    if (u) u.disabled = !bomUndo.length;
    if (r) r.disabled = !bomRedo.length;
  }

  function pushBomUndo(snapshot) {
    var snap = snapshot || bomSnapshot();
    if (bomUndo.length && bomUndo[bomUndo.length - 1] === snap) return;
    bomUndo.push(snap);
    if (bomUndo.length > 100) bomUndo.shift();
    bomRedo = [];
    updateBomHistoryButtons();
  }

  function restoreBomSnapshot(snapshot) {
    var d = null;
    try { d = JSON.parse(snapshot); } catch (e) { return; }
    state.bomRows = Array.isArray(d.rows) ? d.rows : [];
    state.bomMeta = d.meta && typeof d.meta === 'object' ? d.meta : {};
    bomThumbs = {};
    ensure();
    renderBomTable();
    saveBom();
  }

  function undoBom() {
    if (!bomUndo.length) return;
    var current = bomSnapshot();
    var prev = bomUndo.pop();
    bomRedo.push(current);
    restoreBomSnapshot(prev);
    bomEditSnap = bomSnapshot();
    bomEditPushed = true;
    setStatus('已撤销上一步 BOM 修改。', '');
    updateBomHistoryButtons();
  }

  function redoBom() {
    if (!bomRedo.length) return;
    var current = bomSnapshot();
    var next = bomRedo.pop();
    bomUndo.push(current);
    restoreBomSnapshot(next);
    bomEditSnap = bomSnapshot();
    bomEditPushed = true;
    setStatus('已重做 BOM 修改。', '');
    updateBomHistoryButtons();
  }

  function markBomEditStarted() {
    bomEditSnap = bomSnapshot();
    bomEditPushed = false;
  }

  function markBomEditChanged() {
    if (bomEditPushed || !bomEditSnap) return;
    if (bomSnapshot() === bomEditSnap) return;
    pushBomUndo(bomEditSnap);
    bomEditPushed = true;
  }

  function syncBomDocHead() {
    ensure();
    var m = state.bomMeta;
    var map = {
      bomCompany: 'company', bomDocName: 'docName',
      bomProductName: 'productName', bomProductModel: 'productModel',
      bomPreparedBy: 'preparedBy', bomCheckedBy: 'checkedBy',
      bomReviewedBy: 'reviewedBy', bomVersion: 'version',
      bomPreparedDate: 'preparedDate', bomModifiedDate: 'modifiedDate'
    };
    Object.keys(map).forEach(function (id) {
      var el = $(id);
      if (el) el.value = m[map[id]] || '';
    });
    var logo = $('bomLogo');
    if (logo) logo.src = m.logo || 'logo.png';
    var qlogo = $('quoteLogo');
    if (qlogo) qlogo.src = m.logo || 'logo.png';
    var qcompany = $('quoteCompany');
    if (qcompany) qcompany.value = m.company || '';
    updateDocStamp();
    renderRevisionRows();
    updateBomHistoryButtons();
  }

  function updateDocStamp() {
    var m = state.bomMeta || {};
    var vs = $('bomVersionShow');
    if (vs) vs.textContent = m.version || 'A';
    var ds = $('bomDateShow');
    if (ds) ds.textContent = m.modifiedDate || m.preparedDate || '—';
  }

  function renderRevisionRows() {
    var tb = $('bomRevRows');
    if (!tb) return;
    ensure();
    var revs = state.bomMeta.revisions || [];
    if (!revs.length) {
      tb.innerHTML = '<tr><td colspan="6" style="color:var(--faint);padding:8px">' +
        '暂无修改记录，点“+ 添加记录”新增。</td></tr>';
      return;
    }
    tb.innerHTML = revs.map(function (r, i) {
      return '<tr data-rev="' + i + '">' +
        '<td class="revno"><input data-rf="version" value="' + esc(r.version || '') + '" placeholder="A"></td>' +
        '<td class="revdate"><input data-rf="date" type="date" value="' + esc(r.date || '') + '"></td>' +
        '<td><input data-rf="content" value="' + esc(r.content || '') + '" placeholder="修改内容"></td>' +
        '<td class="revby"><input data-rf="prepared" value="' + esc(r.prepared || '') + '" placeholder="编制"></td>' +
        '<td class="revby"><input data-rf="reviewed" value="' + esc(r.reviewed || '') + '" placeholder="审核"></td>' +
        '<td class="revdel"><button class="delrev" data-revdel="' + i + '" title="删除">×</button></td>' +
        '</tr>';
    }).join('');
  }

  function addRevisionRow() {
    ensure();
    pushBomUndo();
    state.bomMeta.revisions.push({
      version: state.bomMeta.version || 'A',
      date: state.bomMeta.modifiedDate || new Date().toISOString().slice(0, 10),
      content: '',
      prepared: state.bomMeta.preparedBy || '',
      reviewed: state.bomMeta.reviewedBy || ''
    });
    renderRevisionRows();
    saveBom();
  }

  function syncRevisionInput(e) {
    var tr = e.target.closest('#bomRevRows tr[data-rev]');
    if (!tr) return;
    var idx = parseInt(tr.getAttribute('data-rev'), 10);
    var field = e.target.getAttribute('data-rf');
    if (!field || !state.bomMeta.revisions[idx]) return;
    state.bomMeta.revisions[idx][field] = e.target.value;
    if (field === 'date') state.bomMeta.modifiedDate = e.target.value;
    markBomEditChanged();
    saveBom();
  }

  function deleteRevisionRow(idx) {
    if (!state.bomMeta.revisions[idx]) return;
    pushBomUndo();
    state.bomMeta.revisions.splice(idx, 1);
    renderRevisionRows();
    saveBom();
  }

  function kindInfo(kind) {
    if (kind === '组件') return { cls: 'asm', label: '组件' };
    if (kind === '标准件') return { cls: 'std', label: '标准件' };
    if (kind === '外购件') return { cls: 'buy', label: '外购件' };
    return { cls: 'part', label: '零件' };
  }

  function classifyKind(name, file, isAssembly) {
    if (isAssembly) return '组件';
    var s = String(name || '') + ' ' + String(file || '');
    if (/(^|[\s_.-])(ISO|GB|DIN|JIS|ANSI|UNI|BS)[\/\s_.-]?\d/i.test(s) ||
        /螺钉|螺栓|螺母|垫圈|垫片|卡簧|挡圈|轴承|销轴|销钉|铆钉|螺柱|O型圈|密封圈/.test(s)) {
      return '标准件';
    }
    return '零件';
  }
  var MAT_GROUP = {
    plastic: '塑料', sheet: '钣金', diecast: '压铸', cnc: 'CNC',
    print3d: '3D 打印', profile: '铝型材', pcb: 'PCB / 覆铜板'
  };

  function allMaterialOptions(selected) {
    var html = '<option value="">— 无材料 / 未指定 —</option>';
    var found = false;
    if (typeof MATERIALS !== 'undefined') {
      Object.keys(MATERIALS).forEach(function (cat) {
        html += '<optgroup label="' + (MAT_GROUP[cat] || cat) + '">';
        (MATERIALS[cat] || []).forEach(function (m) {
          var name = m.name || m.key;
          var hit = (selected === name || selected === m.key);
          if (hit) found = true;
          html += '<option value="' + esc(name) + '"' +
            (hit ? ' selected' : '') + '>' + esc(name) + '</option>';
        });
        html += '</optgroup>';
      });
    }
    if (selected && !found) {
      html += '<option value="' + esc(selected) + '" selected>' +
        esc(selected) + '（自定义）</option>';
    }
    return html;
  }

  function finishName(key) {
    return {
      none: '无', matte: '哑光', gloss: '亮光', sand: '砂纹',
      orange: '橘皮', brushed: '拉丝', shot: '抛丸',
      sand100: '喷砂100目', sand120: '喷砂120目', mirror: '镜面'
    }[key] || key || '';
  }

  function surfaceName(value) {
    var v = String(value || '');
    if (!v || v === 'none') return '无';
    if (typeof SURFACES !== 'undefined') {
      for (var i = 0; i < SURFACES.length; i++) {
        if (SURFACES[i].key === v || SURFACES[i].name === v) {
          return SURFACES[i].name;
        }
      }
    }
    return v;
  }

  function fillBomDatalists() {
    function options(list) {
      return list.map(function (v) {
        return '<option value="' + esc(v) + '"></option>';
      }).join('');
    }
    var names = [];
    if (typeof MATERIALS !== 'undefined') {
      Object.keys(MATERIALS).forEach(function (cat) {
        (MATERIALS[cat] || []).forEach(function (m) {
          var n = m.name || m.key;
          if (n && names.indexOf(n) < 0) names.push(n);
        });
      });
    }
    var ml = $('bomMaterialList');
    if (ml) ml.innerHTML = options(names);
    var sl = $('bomSurfaceList');
    if (sl && typeof SURFACES !== 'undefined') {
      sl.innerHTML = options(SURFACES.map(function (s) { return s.name; }));
    }
    var fl = $('bomFinishList');
    if (fl) {
      fl.innerHTML = options(['无', '哑光', '亮光', '砂纹', '橘皮',
        '拉丝', '抛丸', '喷砂100目', '喷砂120目', '镜面']);
    }
  }

  function surfaceOptions(selected) {
    var list = (typeof SURFACES !== 'undefined' && SURFACES.length)
      ? SURFACES : [{ key: 'none', name: '无' }];
    var found = false;
    var html = list.map(function (s) {
      if (s.key === selected) found = true;
      return '<option value="' + esc(s.key) + '"' +
        (s.key === selected ? ' selected' : '') + '>' + esc(s.name) + '</option>';
    }).join('');
    if (selected && selected !== 'none' && !found) {
      html += '<option value="' + esc(selected) + '" selected>' +
        esc(selected) + '（自定义）</option>';
    }
    return html;
  }

  function finishOptions(selected) {
    var found = false;
    var html = [
      ['none', '无'], ['matte', '哑光'], ['gloss', '亮光'], ['sand', '砂纹'],
      ['orange', '橘皮'], ['brushed', '拉丝'], ['shot', '抛丸'],
      ['sand100', '喷砂100目'], ['sand120', '喷砂120目'], ['mirror', '镜面']
    ].map(function (p) {
      if (p[0] === selected) found = true;
      return '<option value="' + p[0] + '"' + (p[0] === selected ? ' selected' : '') +
        '>' + p[1] + '</option>';
    }).join('');
    if (selected && selected !== 'none' && !found) {
      html += '<option value="' + esc(selected) + '" selected>' +
        esc(selected) + '（自定义）</option>';
    }
    return html;
  }
  function kindOptions(selected) {
    return ['组件', '零件', '标准件', '外购件'].map(function (k) {
      return '<option' + (k === selected ? ' selected' : '') + '>' + k + '</option>';
    }).join('');
  }
  function levelPad(level) {
    var s = String(level || '0');
    return ((s.match(/\./g) || []).length) * 14;
  }
  function rowTotal(r) { return num(r.qty) * num(r.unitWeight); }
  function fmtDims(size) {
    if (!size || !size.length) return "";
    return size.map(function (v) {
      var n = Math.round(num(v) * 10) / 10;
      return String(n);
    }).join("×");
  }
  function massToGram(mass, density) {
    var m = num(mass);
    if (!(m > 0)) return 0;
    var d = num(density);
    if (d > 0) {
      if (d < 0.0001) m = m * 1000;      // kg/mm3 -> g
      else if (d >= 0.1) m = m / 1000;   // mg/mm3 -> g
    } else if (m < 1) {
      m = m * 1000;
    }
    return Math.round(m * 100) / 100;
  }
  function byId(id) {
    for (var i = 0; i < state.bomRows.length; i++) {
      if (state.bomRows[i].id === id) return state.bomRows[i];
    }
    return null;
  }

  // Model rows are matched by file name.  User-added rows (no file) are always
  // kept as extra rows, so a re-import never silently discards manual work.
  function mergeModelRows(newRows) {
    var kept = (state.bomRows || []).filter(function (r) {
      return r.manual || r.locked;
    });
    if (!kept.length) return newRows;
    var byFile = {};
    kept.forEach(function (r) {
      var k = String(r.file || '').toLowerCase();
      if (k && !byFile[k]) byFile[k] = r;
    });
    var used = {};
    var merged = newRows.map(function (nr) {
      var k = String(nr.file || '').toLowerCase();
      var old = k ? byFile[k] : null;
      if (old && !used[old.id]) {
        used[old.id] = true;
        return old;
      }
      return nr;
    });
    kept.forEach(function (r) {
      if (!used[r.id]) merged.push(r);
    });
    return merged;
  }

  function renderBomTable() {
    ensure();
    var tb = $('bomRows');
    if (!tb) return;
    var html = '';
    state.bomRows.forEach(function (r, i) {
      var ki = kindInfo(r.kind);
      var total = rowTotal(r);
      var dis = r.locked ? ' disabled' : '';
      var rowCls = ((r.manual ? ' manual' : '') + (r.locked ? ' locked' : '')).trim();
      html += '<tr data-id="' + r.id + '"' +
        (rowCls ? ' class="' + rowCls + '"' : '') + '>' +
        '<td class="b-no"><input type="checkbox" class="bompick" data-pick="' +
          r.id + '"' + (bomPicked[r.id] ? ' checked' : '') +
          ' title="勾选后可批量锁定或删除' +
          (r.manual ? '（手工添加行，从 Creo 重新生成时保留）' : '') +
          '"><span class="rownum"' +
          (r.manual ? ' title="手工添加的行"' : '') + '>' + (i + 1) + '</span></td>' +
        '<td class="b-level"><input data-f="level" value="' + esc(r.level) + '"' + dis + '></td>' +
        '<td class="b-kind"><span class="kinddot ' + ki.cls + '"></span>' +
          '<input data-f="kind" list="bomKindList" value="' + esc(r.kind) +
          '" placeholder="类别"' + dis + '></td>' +
        '<td class="b-thumb">' +
          (bomThumbs[r.id] ? '<img class="bomthumb" data-id="' + r.id +
            '" src="' + esc(bomThumbs[r.id]) +
            '" alt="" title="' + esc(r.name) +
            '" onclick="window.open(this.src,\'_blank\')" ' +
            'onerror="window.bomThumbFailed && window.bomThumbFailed(this)">' :
            '<span class="thumbnone" title="没有缩略图">—</span>') + '</td>' +
        '<td class="b-name namecell" style="padding-left:' + (6 + levelPad(r.level)) +
          'px"><input data-f="name" value="' + esc(r.name) +
          '" placeholder="零件/组件名称"' + dis + '></td>' +
        '<td class="b-mat"><select data-f="material" title="材料分类"' + dis + '>' +
          allMaterialOptions(r.material || '') +
          '<option value="__custom__">＋ 自定义材料…</option></select></td>' +
        '<td class="b-surface"><select data-f="surface" title="表面处理"' + dis + '>' +
          surfaceOptions(surfaceKeyFrom(r.surface || 'none')) + '</select></td>' +
        '<td class="b-finish"><select data-f="finish" title="表面效果"' + dis + '>' +
          finishOptions(finishKeyFrom(r.finish || 'none')) + '</select></td>' +
        '<td class="b-color"><input data-f="color" list="bomColors" value="' +
          esc(r.color || '') + '" placeholder="颜色"' + dis + '></td>' +
        '<td class="b-qty"><input type="number" min="0" step="1" data-f="qty" value="' +
          num(r.qty) + '"' + dis + '></td>' +
        '<td class="b-num"><input type="number" min="0" step="0.01" data-f="unitWeight" value="' +
          (num(r.unitWeight) || '') + '"' + dis + '></td>' +
        '<td class="b-num rowtotal">' + (total > 0 ? total.toFixed(2) : '—') + '</td>' +
        '<td class="b-drawn"><select data-f="drawn"' + dis + '>' +
          '<option' + (r.drawn === 'Y' ? ' selected' : '') + '>Y</option>' +
          '<option' + (r.drawn !== 'Y' ? ' selected' : '') + '>N</option></select></td>' +
        '<td class="b-outline"><input data-f="outline" value="' + esc(r.outline) +
          '" placeholder="长*宽*高"' + dis + '></td>' +
        '<td class="b-remark"><input data-f="remark" value="' + esc(r.remark || '') +
          '" placeholder="备注"' + dis + '></td>' +
        '<td class="b-act"><button class="lockrow' + (r.locked ? ' on' : '') +
          '" data-lock="' + r.id + '" title="' + (r.locked
            ? '解锁此行' : '锁定此行：禁止编辑/删除，从 Creo 重新生成时保留') + '">' +
          '<svg class="ico" aria-hidden="true"><use href="#i-lock"></use></svg></button>' +
          '<button class="delrow" data-del="' + r.id + '" title="' +
          (r.locked ? '已锁定，需先解锁' : '删除') + '"' +
          (r.locked ? ' disabled' : '') + '>×</button></td>' +
        '</tr>';
    });
    tb.innerHTML = html;
    syncPickUi();
    var rc = $('bomRowCount');
    if (rc) rc.textContent = '共 ' + state.bomRows.length + ' 行';
    initColumnResize();
    initBomSelection();
    var empty = $('bomEmpty');
    if (empty) empty.classList.toggle('show', !state.bomRows.length);
    var summary = $('bomSummaryOut');
    if (summary) summary.innerHTML = '';
    updateBomTotals();
    updateBomAssoc();
    updateBomHistoryButtons();
  }

  var BOM_COL_KEY = 'bomColWidths_v2';
  var BOM_COL_DEFAULTS = [58, 46, 80, 44, 220, 100, 90, 80, 60, 50, 62, 62, 52, 140, 100, 56];

  function bomColKey(th, idx) {
    var c = th.className.split(/\s+/).filter(function (x) {
      return x.indexOf('b-') === 0;
    })[0];
    return c || ('col' + idx);
  }

  function loadColWidths() {
    try { return JSON.parse(localStorage.getItem(BOM_COL_KEY) || '{}'); } catch (e) { return {}; }
  }

  function ensureBomColgroup() {
    var table = document.getElementById('bomTable');
    if (!table) return null;
    var cg = table.querySelector('colgroup');
    if (!cg) {
      cg = document.createElement('colgroup');
      table.insertBefore(cg, table.firstChild);
    }
    var ths = table.querySelectorAll('thead th');
    while (cg.children.length < ths.length) cg.appendChild(document.createElement('col'));
    while (cg.children.length > ths.length) cg.removeChild(cg.lastChild);
    return cg;
  }

  function syncBomTableWidth() {
    var table = document.getElementById('bomTable');
    var cg = ensureBomColgroup();
    if (!table || !cg) return;
    var total = 0;
    for (var i = 0; i < cg.children.length; i++) {
      total += parseFloat(cg.children[i].style.width) || 0;
    }
    if (total > 0) {
      table.style.width = total + 'px';
      table.style.minWidth = total + 'px';
    }
  }

  function applyBomColWidths() {
    var table = document.getElementById('bomTable');
    var cg = ensureBomColgroup();
    if (!table || !cg) return;
    var saved = loadColWidths();
    var ths = table.querySelectorAll('thead th');
    for (var i = 0; i < cg.children.length; i++) {
      var th = ths[i];
      var key = th ? bomColKey(th, i) : ('col' + i);
      var w = parseFloat(saved[key]);
      if (!(w > 0)) w = BOM_COL_DEFAULTS[i] || 80;
      if (i === 4 && !(parseFloat(saved['b-name']) > 0)) {
        var max = 0;
        state.bomRows.forEach(function (r) {
          var n = String(r.name || '').length;
          if (n > max) max = n;
        });
        w = Math.min(420, Math.max(180, max * 9 + 44));
      }
      // Older saved layouts used 38 px for 序号 and 32 px for the action
      // column; widen them so the new checkbox and lock button always fit.
      if (i === 0) w = Math.max(w, 58);
      if (i === 15) w = Math.max(w, 56);
      cg.children[i].style.width = Math.round(w) + 'px';
    }
    syncBomTableWidth();
  }

  function initColumnResize() {
    var table = document.getElementById('bomTable');
    var cg = ensureBomColgroup();
    if (!table || !cg) return;
    applyBomColWidths();
    var saved = loadColWidths();
    var ths = table.querySelectorAll('thead th');
    ths.forEach(function (th, idx) {
      var key = bomColKey(th, idx);
      if (th.querySelector('.colres')) return;
      var grip = document.createElement('span');
      grip.className = 'colres';
      grip.title = '拖动调整列宽';
      th.appendChild(grip);
      grip.addEventListener('mousedown', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var startX = e.clientX;
        var col = cg.children[idx];
        var startW = parseFloat(col.style.width) || th.offsetWidth;
        function move(ev) {
          var w = Math.max(56, Math.round(startW + ev.clientX - startX));
          col.style.width = w + 'px';
          syncBomTableWidth();
        }
        function up() {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          try {
            saved[key] = parseFloat(col.style.width) || 0;
            localStorage.setItem(BOM_COL_KEY, JSON.stringify(saved));
          } catch (e2) { }
        }
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      });
    });
  }

  // ---------- Excel 式单元格选择 / 复制粘贴 / 下拉填充 ----------
  var BOM_COL_FIELDS = ['', 'level', 'kind', '', 'name', 'material',
    'surface', 'finish', 'color', 'qty', 'unitWeight', '',
    'drawn', 'outline', 'remark', ''];

  function bomBodyRows() {
    var tb = $('bomRows');
    return tb ? Array.prototype.slice.call(tb.rows) : [];
  }

  function bomCellAt(r, c) {
    var rows = bomBodyRows();
    var tr = rows[r];
    if (!tr) return null;
    return tr.children[c] || null;
  }

  function bomCellField(td) {
    if (!td) return '';
    var el = td.querySelector('[data-f]');
    return el ? el.getAttribute('data-f') : '';
  }

  function bomCellValue(td) {
    if (!td) return '';
    var el = td.querySelector('[data-f]');
    if (el) return el.value;
    return (td.textContent || '').trim();
  }

  function bomTableFocused() {
    var table = $('bomTable');
    var a = document.activeElement;
    return !!(table && a && (a === table || table.contains(a)));
  }

  function clearBomSelection() {
    bomSel = null;
    bomAnchor = null;
    var tb = $('bomTable');
    if (tb) {
      Array.prototype.forEach.call(tb.querySelectorAll('.cellsel,.sel-edge,.colsel'), function (el) {
        el.classList.remove('cellsel', 'sel-edge', 'colsel');
      });
      var h = document.getElementById('bomFillHandle');
      if (h && h.parentNode) h.parentNode.removeChild(h);
    }
  }

  function applyBomSelection() {
    var rows = bomBodyRows();
    if (!bomSel || !rows.length) { clearBomSelection(); return; }
    bomSel.r1 = Math.max(0, Math.min(bomSel.r1, rows.length - 1));
    bomSel.r2 = Math.max(0, Math.min(bomSel.r2, rows.length - 1));
    var maxC = rows[0].children.length - 1;
    bomSel.c1 = Math.max(0, Math.min(bomSel.c1, maxC));
    bomSel.c2 = Math.max(0, Math.min(bomSel.c2, maxC));

    var table = $('bomTable');
    if (table) {
      Array.prototype.forEach.call(table.querySelectorAll('.cellsel,.sel-edge'), function (el) {
        el.classList.remove('cellsel', 'sel-edge');
      });
    }
    for (var r = bomSel.r1; r <= bomSel.r2; r++) {
      for (var c = bomSel.c1; c <= bomSel.c2; c++) {
        var td = bomCellAt(r, c);
        if (td) td.classList.add('cellsel');
      }
    }
    var last = bomCellAt(bomSel.r2, bomSel.c2);
    if (last) {
      last.classList.add('sel-edge');
      var old = document.getElementById('bomFillHandle');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      var handle = document.createElement('span');
      handle.id = 'bomFillHandle';
      handle.className = 'fillhandle';
      handle.title = '拖动向下/向右填充';
      last.appendChild(handle);
    }
  }

  function selectBomRange(r1, c1, r2, c2, keepAnchor) {
    var rows = bomBodyRows();
    if (!rows.length) return;
    bomSel = {
      r1: Math.min(r1, r2), r2: Math.max(r1, r2),
      c1: Math.min(c1, c2), c2: Math.max(c1, c2)
    };
    if (!keepAnchor) bomAnchor = { r: r1, c: c1 };
    applyBomSelection();
  }

  function bomHit(e) {
    var td = e.target && e.target.closest ? e.target.closest('td') : null;
    if (!td || !td.closest('#bomRows')) return null;
    var tr = td.parentNode;
    var rows = bomBodyRows();
    var r = rows.indexOf(tr);
    var c = Array.prototype.indexOf.call(tr.children, td);
    if (r < 0 || c < 0) return null;
    return { r: r, c: c, td: td, tr: tr };
  }

  function selectionTsv() {
    if (!bomSel) return '';
    var lines = [];
    for (var r = bomSel.r1; r <= bomSel.r2; r++) {
      var cells = [];
      for (var c = bomSel.c1; c <= bomSel.c2; c++) {
        cells.push(String(bomCellValue(bomCellAt(r, c)) || '')
          .replace(/\t/g, ' ').replace(/\r?\n/g, ' '));
      }
      lines.push(cells.join('\t'));
    }
    return lines.join('\n');
  }

  function normalizePasteValue(field, value) {
    var v = String(value === undefined || value === null ? '' : value).trim();
    if (field === 'surface' && typeof SURFACES !== 'undefined') {
      for (var i = 0; i < SURFACES.length; i++) {
        if (SURFACES[i].key === v || SURFACES[i].name === v) return SURFACES[i].key;
      }
      return v;
    }
    if (field === 'finish') {
      var fm = {
        '无': 'none', '哑光': 'matte', '亮光': 'gloss', '砂纹': 'sand',
        '橘皮': 'orange', '拉丝': 'brushed', '抛丸': 'shot',
        '喷砂100目': 'sand100', '喷砂120目': 'sand120', '镜面': 'mirror'
      };
      return fm[v] || v;
    }
    if (field === 'drawn') return /^(y|yes|是)$/i.test(v) ? 'Y' : 'N';
    if (field === 'qty' || field === 'unitWeight') {
      var n = parseFloat(v.replace(/,/g, ''));
      return isFinite(n) ? n : 0;
    }
    return v;
  }

  function newBomRow() {
    return {
      id: uid(), level: '0', kind: '零件', name: '', material: '',
      surface: 'none', color: '', finish: 'none', remark: '',
      qty: 1, unitWeight: 0, drawn: 'N', outline: '',
      manual: true, locked: false
    };
  }

  function pasteBomTsv(text) {
    if (!bomSel || !text) return;
    var lines = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    if (!lines.length) return;
    var matrix = lines.map(function (line) { return line.split('\t'); });
    pushBomUndo();

    // One value pasted into a multi-cell selection fills the whole selection.
    if (matrix.length === 1 && matrix[0].length === 1 &&
        (bomSel.r2 > bomSel.r1 || bomSel.c2 > bomSel.c1)) {
      var fill = normalizePasteValue('', matrix[0][0]);
      for (var fr = bomSel.r1; fr <= bomSel.r2; fr++) {
        for (var fc = bomSel.c1; fc <= bomSel.c2; fc++) {
          var ffield = BOM_COL_FIELDS[fc];
          if (!ffield) continue;
          var frow = state.bomRows[fr];
          if (frow && !frow.locked) frow[ffield] = normalizePasteValue(ffield, fill);
        }
      }
      renderBomTable();
      saveBom();
      selectBomRange(bomSel.r1, bomSel.c1, bomSel.r2, bomSel.c2);
      return;
    }

    var startR = bomSel.r1, startC = bomSel.c1;
    var maxRows = matrix.length;
    var maxCols = 0;
    matrix.forEach(function (row) { maxCols = Math.max(maxCols, row.length); });
    while (state.bomRows.length < startR + maxRows) {
      state.bomRows.push(newBomRow());
    }
    for (var r = 0; r < matrix.length; r++) {
      for (var c = 0; c < matrix[r].length; c++) {
        var field = BOM_COL_FIELDS[startC + c];
        if (!field) continue;
        var row = state.bomRows[startR + r];
        if (!row || row.locked) continue;
        row[field] = normalizePasteValue(field, matrix[r][c]);
      }
    }
    renderBomTable();
    saveBom();
    selectBomRange(startR, startC,
      Math.min(state.bomRows.length - 1, startR + maxRows - 1),
      startC + maxCols - 1);
  }

  function copySelectionToClipboard() {
    if (!bomSel) return false;
    var text = selectionTsv();
    if (!text) return false;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () {});
    } else {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) { }
      ta.remove();
    }
    return true;
  }

  function fillSelection(targetR, targetC) {
    if (!bomFillDrag || !bomSel) return;
    var src = bomFillDrag;
    var rows = bomBodyRows();
    if (!rows.length) return;
    var down = targetR > src.r2;
    var right = targetC > src.c2;
    if (!down && !right) { bomFillDrag = null; return; }
    pushBomUndo();

    if (down) {
      var srcRows = src.r2 - src.r1 + 1;
      for (var r = src.r2 + 1; r <= targetR; r++) {
        var sr = src.r1 + ((r - src.r2 - 1) % srcRows);
        for (var c = src.c1; c <= src.c2; c++) {
          var from = bomCellAt(sr, c);
          var to = bomCellAt(r, c);
          if (!from || !to) continue;
          var field = bomCellField(to);
          if (!field) continue;
          var row = state.bomRows[r];
          if (row && !row.locked) row[field] = normalizePasteValue(field, bomCellValue(from));
        }
      }
    }
    if (right) {
      var srcCols = src.c2 - src.c1 + 1;
      for (var cc = src.c2 + 1; cc <= targetC; cc++) {
        var sc = src.c1 + ((cc - src.c2 - 1) % srcCols);
        for (var rr = src.r1; rr <= src.r2; rr++) {
          var from2 = bomCellAt(rr, sc);
          var to2 = bomCellAt(rr, cc);
          if (!from2 || !to2) continue;
          var field2 = bomCellField(to2);
          if (!field2) continue;
          var row2 = state.bomRows[rr];
          if (row2 && !row2.locked) row2[field2] = normalizePasteValue(field2, bomCellValue(from2));
        }
      }
    }
    var r1 = src.r1, c1 = src.c1;
    var r2 = Math.max(src.r2, targetR), c2 = Math.max(src.c2, targetC);
    bomFillDrag = null;
    document.body.classList.remove('bomfilling');
    renderBomTable();
    saveBom();
    selectBomRange(r1, c1, r2, c2);
  }

  function startFillDrag(e) {
    if (!bomSel) return;
    e.preventDefault();
    e.stopPropagation();
    bomFillDrag = {
      r1: bomSel.r1, c1: bomSel.c1,
      r2: bomSel.r2, c2: bomSel.c2
    };
    document.body.classList.add('bomfilling');
    function move(ev) {
      var el = document.elementFromPoint(ev.clientX, ev.clientY);
      var td = el && el.closest ? el.closest('td') : null;
      if (!td || !td.closest('#bomRows')) return;
      var tr = td.parentNode;
      var rows = bomBodyRows();
      var r = rows.indexOf(tr);
      var c = Array.prototype.indexOf.call(tr.children, td);
      if (r < 0 || c < 0) return;
      if (r > bomFillDrag.r2 || c > bomFillDrag.c2) {
        selectBomRange(bomFillDrag.r1, bomFillDrag.c1,
          Math.max(bomFillDrag.r2, r), Math.max(bomFillDrag.c2, c), true);
      }
    }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      var target = bomSel || bomFillDrag;
      fillSelection(target.r2, target.c2);
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  function initBomSelection() {
    var table = $('bomTable');
    var tb = $('bomRows');
    if (!table || !tb) return;
    table.setAttribute('tabindex', '0');

    if (table.getAttribute('data-bomsel') === '1') {
      if (bomSel) applyBomSelection();
      return;
    }
    table.setAttribute('data-bomsel', '1');

    tb.addEventListener('mousedown', function (e) {
      if (e.target && e.target.classList &&
          e.target.classList.contains('fillhandle')) {
        startFillDrag(e);
        return;
      }
      // Row checkbox / lock button handle their own click; don't turn the
      // mousedown into a cell drag-selection.
      if (e.target && e.target.closest &&
          (e.target.closest('.bompick') || e.target.closest('[data-lock]'))) return;
      var hit = bomHit(e);
      if (!hit) return;
      if (hit.td.querySelector('input,select,textarea')) {
        markBomEditStarted();
      }
      if (hit.td.classList.contains('b-no')) {
        selectBomRange(hit.r, 0, hit.r, hit.tr.children.length - 2);
        table.focus();
        e.preventDefault();
        return;
      }
      if (e.shiftKey && bomSel) {
        selectBomRange(bomSel.r1, bomSel.c1, hit.r, hit.c, true);
      } else {
        selectBomRange(hit.r, hit.c, hit.r, hit.c);
      }
      if (!hit.td.querySelector('input,select')) {
        table.focus();
        e.preventDefault();
      }
    });

    var head = table.querySelector('thead');
    if (head) {
      head.addEventListener('mousedown', function (e) {
        if (e.target && e.target.classList &&
            e.target.classList.contains('colres')) return;
        if (e.target && e.target.closest && e.target.closest('#bomPickAll')) return;
        var th = e.target && e.target.closest ? e.target.closest('th') : null;
        if (!th) return;
        var idx = Array.prototype.indexOf.call(th.parentNode.children, th);
        var rows = bomBodyRows();
        if (!rows.length) return;
        selectBomRange(0, idx, rows.length - 1, idx);
        table.focus();
        e.preventDefault();
      });
    }

    document.addEventListener('mousedown', function (e) {
      if (!bomSel) return;
      if (e.target && table.contains(e.target)) return;
      clearBomSelection();
    });

    document.addEventListener('copy', function (e) {
      if (!bomSel || !bomTableFocused()) return;
      var text = selectionTsv();
      if (!text) return;
      e.clipboardData.setData('text/plain', text);
      e.preventDefault();
    });

    document.addEventListener('paste', function (e) {
      if (!bomSel || !bomTableFocused()) return;
      var text = e.clipboardData.getData('text/plain');
      if (!text) return;
      e.preventDefault();
      pasteBomTsv(text);
    });

    document.addEventListener('keydown', function (e) {
      if (!bomTableFocused()) return;
      var key = String(e.key || '').toLowerCase();
      if (e.ctrlKey && !e.shiftKey && key === 'z') {
        e.preventDefault();
        undoBom();
        return;
      }
      if (e.ctrlKey && (key === 'y' || (e.shiftKey && key === 'z'))) {
        e.preventDefault();
        redoBom();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (!bomSel || !bomTableFocused()) return;
      if (e.key === 'Escape') { clearBomSelection(); return; }
      if (e.ctrlKey && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        bomFillDrag = {
          r1: bomSel.r1, c1: bomSel.c1, r2: bomSel.r2, c2: bomSel.c2
        };
        fillSelection(state.bomRows.length - 1, bomSel.c2);
        return;
      }
      if (e.ctrlKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        bomFillDrag = {
          r1: bomSel.r1, c1: bomSel.c1, r2: bomSel.r2, c2: bomSel.c2
        };
        var maxC = bomBodyRows()[0] ? bomBodyRows()[0].children.length - 2 : bomSel.c2;
        fillSelection(bomSel.r2, maxC);
      }
    });
  }

  function updateBomAssoc() {
    var box = $('bomAssoc');
    var name = $('bomAssocName');
    var btn = $('bomOpenAsm');
    var asm = state.bomMeta && state.bomMeta.assembly;
    if (!asm) { if (box) box.hidden = true; return; }
    if (box) box.hidden = false;
    if (name) name.textContent = asm;
    if (btn) {
      btn.onclick = function () {
        var path = state.bomMeta && state.bomMeta.assemblyPath;
        if (!path) { setStatus('没有记录装配完整路径，无法打开。', 'warn'); return; }
        fetch(BRIDGE + '/model/open', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: path })
        }).then(function (res) {
          return res.json();
        }).then(function (d) {
          if (!d || d.ok === false) throw new Error((d && d.error) || '打开失败');
          setStatus('已打开装配：' + (d.message || d.name || path), 'ok');
        }).catch(function (e) {
          setStatus('打开装配失败：' + (e.message || e), 'err');
        });
      };
    }
  }

  function updateBomTotals() {
    var qty = 0, weight = 0;
    state.bomRows.forEach(function (r) {
      qty += num(r.qty);
      weight += rowTotal(r);
    });
    if ($('bomTQty')) $('bomTQty').textContent = qty > 0 ? String(qty) : '—';
    if ($('bomTWeight')) {
      $('bomTWeight').textContent = weight > 0
        ? (weight / 1000).toFixed(2) + ' kg' : '—';
    }
  }

  function onInput(e) {
    var tr = e.target.closest('#bomRows tr');
    if (!tr) return;
    var r = byId(tr.getAttribute('data-id'));
    if (!r || r.locked) return;
    var f = e.target.getAttribute('data-f');
    if (!f) return;
    if (f === 'qty' || f === 'unitWeight') {
      r[f] = e.target.value;
      var td = tr.querySelector('.rowtotal');
      var total = rowTotal(r);
      if (td) td.textContent = total > 0 ? total.toFixed(2) : '—';
      updateBomTotals();
      markBomEditChanged();
      saveBom();
      return;
    }
    var val = e.target.value;
    if (f === 'material' && val === '__custom__') return;
    if (f === 'surface') val = surfaceKeyFrom(val);
    if (f === 'finish') val = finishKeyFrom(val);
    r[f] = val;
    markBomEditChanged();
    saveBom();
  }

  function onChange(e) {
    var tr = e.target.closest('#bomRows tr');
    if (!tr) return;
    var r = byId(tr.getAttribute('data-id'));
    if (!r || r.locked) return;
    var f = e.target.getAttribute('data-f');
    if (f === 'kind') {
      r.kind = e.target.value;
      markBomEditChanged();
      renderBomTable();
      saveBom();
    } else if (f === 'drawn') {
      r.drawn = e.target.value;
      markBomEditChanged();
      saveBom();
    } else if (f === 'material' && e.target.value === '__custom__') {
      var cur = String(r.material || '');
      var name = window.prompt('输入自定义材料名称（例如：SUS316L、POM+GF30）', cur);
      if (name !== null) {
        name = String(name).trim();
        if (name) {
          r.material = name;
          markBomEditChanged();
          saveBom();
        }
      }
      renderBomTable();
    } else if (f === 'surface' || f === 'finish' || f === 'material') {
      if (f === 'surface') r.surface = surfaceKeyFrom(e.target.value);
      else if (f === 'finish') r.finish = finishKeyFrom(e.target.value);
      else r.material = e.target.value;
      markBomEditChanged();
      saveBom();
    } else if (f === 'level') {
      r.level = e.target.value;
      markBomEditChanged();
      renderBomTable();
      saveBom();
    }
  }

  function onClick(e) {
    var pick = e.target.closest ? e.target.closest('.bompick') : null;
    if (pick) {
      var pid = pick.getAttribute('data-pick');
      if (pick.checked) bomPicked[pid] = true;
      else delete bomPicked[pid];
      syncPickUi();
      return;
    }
    var lockBtn = e.target.closest ? e.target.closest('[data-lock]') : null;
    if (lockBtn) {
      toggleRowLocks([lockBtn.getAttribute('data-lock')]);
      return;
    }
    var b = e.target.closest('[data-del]');
    if (!b) return;
    var id = b.getAttribute('data-del');
    var row = byId(id);
    if (row && row.locked) {
      setStatus('该行已锁定，请先点行尾的锁按钮解锁后再删除。', 'warn');
      return;
    }
    pushBomUndo();
    delete bomThumbs[id];
    delete bomPicked[id];
    state.bomRows = state.bomRows.filter(function (r) { return r.id !== id; });
    clearBomSelection();
    renderBomTable();
    saveBom();
    setStatus('已删除 1 行 BOM。', '');
  }

  function pickedIds() {
    return state.bomRows
      .filter(function (r) { return !!bomPicked[r.id]; })
      .map(function (r) { return r.id; });
  }

  function selectedRowIds() {
    var ids = [];
    if (!bomSel) return ids;
    for (var i = bomSel.r1; i <= bomSel.r2; i++) {
      var r = state.bomRows[i];
      if (r) ids.push(r.id);
    }
    return ids;
  }

  function actionRowIds() {
    var ids = pickedIds();
    return ids.length ? ids : selectedRowIds();
  }

  function syncPickUi() {
    var tb = $('bomRows');
    var picked = 0;
    if (tb) {
      Array.prototype.forEach.call(tb.querySelectorAll('input.bompick'), function (cb) {
        var id = cb.getAttribute('data-pick');
        cb.checked = !!bomPicked[id];
      });
    }
    state.bomRows.forEach(function (r) { if (bomPicked[r.id]) picked++; });
    var all = $('bomPickAll');
    if (all) {
      all.checked = picked > 0 && picked === state.bomRows.length;
      all.indeterminate = picked > 0 && picked < state.bomRows.length;
      all.disabled = !state.bomRows.length;
    }
    var bd = $('bomBatchDel');
    if (bd) bd.disabled = !state.bomRows.length;
    var bl = $('bomLock');
    if (bl) bl.disabled = !state.bomRows.length;
  }

  function setAllPicked(on) {
    state.bomRows.forEach(function (r) {
      if (on) bomPicked[r.id] = true;
      else delete bomPicked[r.id];
    });
    syncPickUi();
  }

  function toggleRowLocks(ids) {
    var rows = ids.map(byId).filter(function (r) { return !!r; });
    if (!rows.length) {
      setStatus('请先勾选行首复选框，或点选要操作的单元格行。', 'warn');
      return;
    }
    pushBomUndo();
    var lock = rows.some(function (r) { return !r.locked; });
    rows.forEach(function (r) { r.locked = lock; });
    renderBomTable();
    saveBom();
    setStatus((lock ? '已锁定 ' : '已解锁 ') + rows.length +
      ' 行。锁定行禁止编辑/删除，从 Creo 重新生成时保持不变。', '');
  }

  function batchDeleteRows() {
    ensure();
    var ids = actionRowIds();
    if (!ids.length) {
      setStatus('请先勾选要删除的行（行首复选框），或点选要删除的单元格行。', 'warn');
      return;
    }
    var rows = ids.map(byId).filter(function (r) { return !!r; });
    var locked = rows.filter(function (r) { return r.locked; });
    var del = rows.filter(function (r) { return !r.locked; });
    if (!del.length) {
      setStatus('选中的 ' + rows.length + ' 行都已锁定，请先解锁。', 'warn');
      return;
    }
    if (!confirm('删除选中的 ' + del.length + ' 行 BOM？' +
      (locked.length ? '（另有 ' + locked.length + ' 行已锁定，将跳过）' : '') +
      '报价明细不会受影响。')) return;
    pushBomUndo();
    var drop = {};
    del.forEach(function (r) {
      drop[r.id] = true;
      delete bomThumbs[r.id];
      delete bomPicked[r.id];
    });
    state.bomRows = state.bomRows.filter(function (r) { return !drop[r.id]; });
    clearBomSelection();
    renderBomTable();
    saveBom();
    setStatus('已删除 ' + del.length + ' 行 BOM。' +
      (locked.length ? '跳过 ' + locked.length + ' 行已锁定。' : ''), '');
  }

  function addRow() {
    ensure();
    pushBomUndo();
    state.bomRows.push({
      id: uid(), level: '0', kind: '零件', name: '', material: '',
      surface: 'none', color: '', finish: 'none', remark: '',
      qty: 1, unitWeight: 0, drawn: 'N', outline: '',
      manual: true, locked: false
    });
    renderBomTable();
    saveBom();
    var tb = $('bomRows');
    var last = tb ? tb.lastElementChild : null;
    if (last) {
      last.scrollIntoView({ block: 'nearest' });
      var inp = last.querySelector('input[data-f="name"]');
      if (inp) inp.focus();
    }
  }

  function clearBom() {
    if (!state.bomRows.length) return;
    if (!confirm('清空当前产品BOM？锁定行也会一并清空。报价明细不会受影响。')) return;
    pushBomUndo();
    state.bomRows = [];
    bomThumbs = {};
    bomPicked = {};
    clearBomSelection();
    renderBomTable();
    saveBom();
    setStatus('产品BOM已清空。', '');
  }

  function demoRows() {
    function r(level, kind, name, material, qty, unitWeight, drawn, outline, surface, color, finish, remark) {
      return {
        id: uid(), level: level, kind: kind, name: name, material: material || '',
        surface: surface || 'none', color: color || '', finish: finish || 'none',
        remark: remark || '',
        qty: qty || 1, unitWeight: unitWeight || 0,
        drawn: drawn || 'N', outline: outline || ''
      };
    }
    return [
      r('0', '组件', '滚轮组件2', '', 1, 0, 'N', ''),
      r('1', '零件', '滚轮连接侧板-长', 'AL6061', 1, 510.72, 'Y', '290.00*79.00*39.08'),
      r('2', '零件', '轴承销轴', 'SUS304', 1, 62.85, 'Y', '31.80*44.00*43.85'),
      r('3', '零件', '轴承销轴_SOLO_B8S1', 'SUS304', 1, 62.85, 'Y', '31.80*44.00*43.85'),
      r('4', '零件', '轴承D22OD50T14', 'STEEL', 2, 170.57, 'Y', '50.00*50.00*14.00'),
      r('5', '零件', 'STW2-2卡簧', 'STEEL', 2, 1.99, 'Y', '26.20*29.18*1.20'),
      r('6', '组件', '横向轴承组件', '', 2, 0, 'N', '24.50*48.00*20.00'),
      r('6.1', '零件', '横向轴承座', 'SUS304', 1, 62.56, 'Y', '21.00*46.00*20.00'),
      r('6.2', '组件', 'GFR8', '', 1, 0, 'N', '32.00*19.00*19.00'),
      r('6.2.1', '零件', 'GFR8_B', '', 1, 0, 'N', '32.00*19.00*19.00'),
      r('6.2.2', '零件', 'NUT_CUA_8', '', 1, 0, 'N', '6.80*15.01*13.00'),
      r('7', '组件', '内六角圆头组合螺钉M5X16', '', 2, 0, 'N', '18.48*10.00*10.00'),
      r('7.1', '零件', '内六角圆头螺钉M5X16', '', 2, 0, 'N', '18.48*9.40*9.40'),
      r('7.2', '零件', 'D5_GB93', 'STEEL', 1, 0.26, 'N', '7.70*7.70*1.30'),
      r('7.3', '零件', 'D5_GB97_1', 'STEEL', 1, 0.43, 'N', '10.00*10.00*1.00'),
      r('8', '零件', 'GB70_M5X16', '', 1, 5.02, 'N', '10.00*21.00*10.00')
    ];
  }

  function loadDemo() {
    if (state.bomRows.length &&
        !confirm('当前已有产品BOM，仍要载入示例并替换？报价明细不会受影响。')) return;
    pushBomUndo();
    state.bomRows = demoRows();
    bomThumbs = {};
    state.bomMeta.template = '常用（默认）';
    if ($('bomTemplate')) $('bomTemplate').value = 'common';
    renderBomTable();
    syncBomDocHead();
    saveBom();
    setStatus('已载入示例BOM（16 行），可直接修改、导出或导入到报价。', '');
  }

  var BOM_TREE = 'http://127.0.0.1:18767';

  var MAX_BOM_DEPTH = 12;   // 与 BomTree.exe 的 MaxDepth 保持一致

  function bomDepthValue() {
    var el = $('bomDepth');
    var raw = el ? String(el.value) : '2';
    if (raw === 'custom') {
      var c = $('bomDepthCustom');
      var n = c ? parseInt(c.value, 10) : 2;
      if (!isFinite(n) || n < 1) n = 2;
      if (n > MAX_BOM_DEPTH) n = MAX_BOM_DEPTH;
      return n;
    }
    var v = parseInt(raw, 10);
    if (!isFinite(v)) v = 2;
    return v > 0 ? v : 0;              // 0 means "all levels"
  }

  function bomDepthLabel(v) {
    return v > 0 ? (v + ' 层') : '全部层级';
  }

  // 只有选中“自定义…”时才显示数字输入框，并把值限制在 1..MAX_BOM_DEPTH。
  function syncBomDepthCustom() {
    var sel = $('bomDepth');
    var inp = $('bomDepthCustom');
    if (!sel || !inp) return;
    inp.style.display = sel.value === 'custom' ? '' : 'none';
    var v = parseInt(inp.value, 10);
    if (!isFinite(v) || v < 1) inp.value = 2;
    else if (v > MAX_BOM_DEPTH) inp.value = MAX_BOM_DEPTH;
  }

  function fetchJson(url, timeoutMs) {
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs) : null;
    return fetch(url, { signal: ctrl ? ctrl.signal : undefined })
      .then(function (res) {
        return res.text().then(function (t) { return { res: res, text: t }; });
      })
      .then(function (o) {
        if (timer) clearTimeout(timer);
        var d = null;
        try { d = JSON.parse(o.text); } catch (e) { }
        if (!o.res.ok || !d) {
          throw new Error((d && (d.error || d.message)) || ('HTTP ' + o.res.status));
        }
        return d;
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
  }

  function applyCreoTree(d, depth) {
    var tree = d && d.tree;
    if (!tree) throw new Error('返回数据里没有装配树');
    var prev = {};
    state.bomRows.forEach(function (r) {
      var k = String(r.file || r.name || '').toLowerCase();
      if (k && !prev[k]) prev[k] = r;
    });
    var rows = [];
    function walk(node, parentLevel) {
      var kids = node.children || [];
      kids.forEach(function (ch, idx) {
        var lv = parentLevel ? parentLevel + '.' + (idx + 1) : String(idx + 1);
        var key = String(ch.file || ch.name || '').toLowerCase();
        var old = prev[key];
        var name = ch.name ||
          String(ch.file || '').replace(/\.(prt|asm)$/i, '');
        rows.push({
          id: uid(), level: lv,
          kind: classifyKind(name, ch.file, ch.isAssembly),
          name: name,
          file: ch.file || '',
          path: ch.path || '',
          material: (old && old.material) ? old.material : (ch.material || ''),
          surface: old ? (old.surface || 'none') : 'none',
          finish: old ? (old.finish || 'none') : 'none',
          color: old ? (old.color || '') : '',
          remark: old ? (old.remark || '') : '',
          qty: ch.qty || 1,
          unitWeight: (old && num(old.unitWeight) > 0)
            ? old.unitWeight : massToGram(ch.mass, ch.density),
          drawn: old ? (old.drawn || 'N') : 'N',
          outline: (ch.size && ch.size.length)
            ? fmtDims(ch.size) : (old ? (old.outline || '') : '')
        });
        if (ch.children && ch.children.length) walk(ch, lv);
      });
    }
    walk(tree, '');
    if (!rows.length) throw new Error('当前装配里没有组件');

    var keptCount = state.bomRows.filter(function (r) {
      return r.manual || r.locked;
    }).length;
    pushBomUndo();
    bomThumbs = {};
    state.bomRows = mergeModelRows(rows);
    state.bomMeta.template = 'Creo 装配';
    state.bomMeta.assembly = d.model || tree.file || '';
    state.bomMeta.assemblyPath = d.path || tree.path || '';
    state.bomMeta.assemblyDepth = depth;
    if (!state.bomMeta.docName || state.bomMeta.docName === '产品 BOM') {
      state.bomMeta.docName = String(d.model || '产品')
        .replace(/\.asm$/i, '') + ' 产品 BOM';
    }
    if ($('bomTemplate')) $('bomTemplate').value = 'common';
    renderBomTable();
    syncBomDocHead();
    saveBom();
    setStatus('已按 ' + bomDepthLabel(depth) + ' 从 Creo 生成 ' + rows.length +
      ' 行多级 BOM' +
      (keptCount ? '；保留 ' + keptCount + ' 行手工添加/锁定的行，可勾选后批量删除' : '') +
      '；子装配已按层级缩进，材料/单重可继续补充。', 'ok');
    setTimeout(function () { loadThumbnails(false); }, 300);
  }

  function importFromCreoBom() {
    if (state.bomRows.length &&
        !confirm('当前已有产品BOM，仍要用 Creo 当前装配重新生成？\n' +
          '已填写的材料、表面处理等会按模型文件名保留；' +
          '手工添加的行和已锁定的行会保留，可勾选后批量删除。\n' +
          '报价明细不会受影响。')) return;
    var depth = bomDepthValue();
    // Probe the optional BomTree service first with a short timeout.  If it is
    // not running, go straight to the bridge fallback instead of making the
    // user wait two minutes for the tree request to time out.
    setStatus('正在检查多级展开服务（BomTree）…', 'info');
    fetchJson(BOM_TREE + '/health', 2500)
      .then(function () {
        setStatus('正在读取当前 Creo 装配（展开 ' + bomDepthLabel(depth) + '）…', 'info');
        return fetchJson(BOM_TREE + '/tree?depth=' + (depth > 0 ? depth : 99) +
          '&_=' + Date.now(), 120000);
      })
      .then(function (d) {
        if (d.ok === false) throw new Error(d.error || '读取装配树失败');
        applyCreoTree(d, depth);
      })
      .catch(function (err) {
        importFlatFromBridge(depth, err);
      });
  }

  function importFlatFromBridge(depth, cause) {
    if (state.bomRows.length &&
        !confirm('当前已有产品BOM，仍要用 Creo 当前装配重新生成？\n' +
          '手工添加的行和已锁定的行会保留，可勾选后批量删除。\n' +
          '报价明细不会受影响。')) return;
    setStatus('多级展开服务（BomTree）不可用' +
      (cause && cause.message ? '（' + cause.message + '）' : '') +
      '，本次只能读取顶层组件（1 层）。请用 start_ai.bat 启动（会同时启动 ' +
      'CreoBridge 和 BomTree），或手动运行 toolbox\\BomTree.exe 后再点“从 Creo 生成”。', 'warn');
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 30000) : null;
    fetch(BRIDGE + '/assembly/info', { signal: ctrl ? ctrl.signal : undefined })
      .then(function (res) {
        return res.text().then(function (t) { return { res: res, text: t }; });
      })
      .then(function (o) {
        if (timer) clearTimeout(timer);
        var d = null;
        try { d = JSON.parse(o.text); } catch (e) { }
        if (!o.res.ok || !d || d.ok === false) {
          throw new Error((d && (d.error || d.message)) || ('HTTP ' + o.res.status));
        }
        var items = d.items || [];
        if (!items.length) throw new Error('当前装配里没有组件');
        var groups = {};
        items.forEach(function (it) {
          var key = String(it.file || it.name || '').toLowerCase();
          if (!key) return;
          if (!groups[key]) {
            groups[key] = {
              name: String(it.name || it.file || '').replace(/\.(prt|asm)(\.\d+)?$/i, ''),
              file: it.file || '',
              path: it.path || '',
              qty: 0,
              size: it.size || null,
              mass: it.mass || 0,
              density: it.density || 0,
              material: it.material || '',
              isAssembly: !!it.isAssembly
            };
          }
          groups[key].qty++;
        });
        var keptCount = state.bomRows.filter(function (r) {
          return r.manual || r.locked;
        }).length;
        var modelRows = Object.keys(groups).map(function (k) {
          var g = groups[k];
          return {
            id: uid(), level: '1', kind: classifyKind(g.name, g.file, g.isAssembly), name: g.name,
            file: g.file, path: g.path || '', material: g.material || '', surface: 'none', color: '', finish: 'none',
            remark: '', qty: g.qty,
            unitWeight: massToGram(g.mass, g.density),
            drawn: 'N', outline: fmtDims(g.size)
          };
        });
        pushBomUndo();
        bomThumbs = {};
        state.bomRows = mergeModelRows(modelRows);
        state.bomMeta.template = 'Creo 装配';
        state.bomMeta.assembly = d.model || '';
        state.bomMeta.assemblyPath = d.path || '';
        state.bomMeta.assemblyDepth = 1;
        if (!state.bomMeta.docName || state.bomMeta.docName === '产品 BOM') {
          state.bomMeta.docName = String(d.model || '产品')
            .replace(/\.asm$/i, '') + ' 产品 BOM';
        }
        if ($('bomTemplate')) $('bomTemplate').value = 'common';
        renderBomTable();
        syncBomDocHead();
        saveBom();
        setStatus('已从 Creo 装配生成 ' + modelRows.length +
          ' 行顶层 BOM（仅 1 层，子装配未展开）' +
          (keptCount ? '；保留 ' + keptCount + ' 行手工添加/锁定的行，可勾选后批量删除' : '') +
          '。' +
          '需要多层请用 start_ai.bat 启动工具箱服务，' +
          '或运行 toolbox\\BomTree.exe 后重试。', 'warn');
        setTimeout(function () { loadThumbnails(false); }, 300);
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        var msg = String(err && err.message ? err.message : err);
        // A dead VB API surfaces as XToolkitCommError; make the fix explicit
        // instead of asking the user to check an already-running bridge.
        if (/XToolkit|VB API|pfcExceptions/i.test(msg)) {
          msg = 'CreoBridge 未连接 Creo（VB API 已断开）。' +
            '请完全退出 Creo，重新启动 Creo 和 start_ai.bat 后再试';
        } else {
          msg += '。请确认 Creo 已打开装配体，且 CreoBridge/BomTree 正在运行';
        }
        setStatus('读取 Creo 装配失败：' + msg + '。', 'err');
      });
  }

  function thumbUrlFor(row, map, dir) {
    var path = String(row.path || '');
    var it = map[String(row.file || '').toLowerCase()] ||
             map[String(row.name || '').toLowerCase()];
    if (!path && it && it.path) path = it.path;
    // Component FullName is often just the model name, without folder or
    // extension; only pass a path when it really names a model file.
    if (path && !/\.(prt|asm)(\.\d+)?$/i.test(path)) path = '';
    var query;
    if (path) {
      query = '?path=' + encodeURIComponent(path);
    } else {
      var name = row.file || row.name;
      if (!name) return '';
      query = '?name=' + encodeURIComponent(name) +
        '&dir=' + encodeURIComponent(dir || '');
    }
    return BRIDGE + '/file/thumb' + query + '&_=' + Date.now();
  }

  function applyThumbnails(map, dir) {
    var count = 0;
    state.bomRows.forEach(function (r) {
      var url = thumbUrlFor(r, map || {}, dir || '');
      if (!url) return;
      bomThumbs[r.id] = url;
      count++;
    });
    renderBomTable();
    return count;
  }

  var thumbGenTimer = null;
  var thumbGenRunning = false;
  var thumbGenTried = {};
  var thumbGenAllowed = false;

  function bomThumbFailed(img) {
    var id = img && img.getAttribute ? img.getAttribute('data-id') : '';
    if (id) {
      delete bomThumbs[id];
      if (img.parentNode) img.parentNode.classList.add('thumbfail');
      img.style.display = 'none';
    }
    if (thumbGenAllowed) scheduleThumbGenerate();
  }
  window.bomThumbFailed = bomThumbFailed;

  function settleThumbStatus() {
    var ok = 0, bad = 0;
    state.bomRows.forEach(function (r) {
      if (bomThumbs[r.id]) ok++;
      else if (r.path || r.file) bad++;
    });
    setStatus('已加载 ' + ok + ' 个缩略图。' +
      (bad ? bad + ' 个模型没有内嵌预览，点“加载缩略图”可用 Creo 生成。' : ''),
      bad ? 'warn' : 'ok');
  }

  function loadCachedThumbs() {
    var rows = state.bomRows.filter(function (r) {
      return r.path && !bomThumbs[r.id];
    });
    if (!rows.length) return;
    fetch(BRIDGE + '/thumb/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: rows.map(function (r) { return r.path; }).join('\n'),
        cacheOnly: true
      })
    })
      .then(function (res) {
        return res.text().then(function (t) { return { res: res, text: t }; });
      })
      .then(function (o) {
        var d = null;
        try { d = JSON.parse(o.text); } catch (e) { }
        if (!o.res.ok || !d || d.ok === false) return;
        var byPath = {};
        (d.items || []).forEach(function (it) {
          byPath[String(it.path || '').toLowerCase()] = it.thumb;
        });
        var n = 0;
        state.bomRows.forEach(function (r) {
          var key = String(r.path || '').toLowerCase();
          if (key && byPath[key]) { bomThumbs[r.id] = byPath[key]; n++; }
        });
        if (n) {
          renderBomTable();
          setStatus('已从 work\\thumbs 缓存加载 ' + n + ' 个缩略图。', 'ok');
        }
      })
      .catch(function () { });
  }

  function scheduleThumbGenerate() {
    if (thumbGenTimer || thumbGenRunning) return;
    thumbGenTimer = setTimeout(function () {
      thumbGenTimer = null;
      generateMissingThumbs();
    }, 700);
  }

  function generateMissingThumbs() {
    if (thumbGenRunning) return;
    var rows = state.bomRows.filter(function (r) {
      return r.path && !bomThumbs[r.id] && !thumbGenTried[String(r.path).toLowerCase()];
    });
    if (!rows.length) return;
    rows.forEach(function (r) {
      thumbGenTried[String(r.path).toLowerCase()] = true;
    });
    thumbGenRunning = true;
    setStatus('内嵌预览缺失，正在用 Creo 生成 ' + rows.length +
      ' 个缩略图，请稍候…（Creo 会短暂打开模型）', 'info');
    fetch(BRIDGE + '/thumb/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: rows.map(function (r) { return r.path; }).join('\n')
      })
    })
      .then(function (res) {
        return res.text().then(function (t) { return { res: res, text: t }; });
      })
      .then(function (o) {
        var d = null;
        try { d = JSON.parse(o.text); } catch (e) { }
        if (!o.res.ok || !d || d.ok === false) {
          throw new Error((d && (d.error || d.message)) || ('HTTP ' + o.res.status));
        }
        var byPath = {};
        (d.items || []).forEach(function (it) {
          byPath[String(it.path || '').toLowerCase()] = it.thumb;
        });
        var n = 0;
        state.bomRows.forEach(function (r) {
          var key = String(r.path || '').toLowerCase();
          if (key && byPath[key]) { bomThumbs[r.id] = byPath[key]; n++; }
        });
        renderBomTable();
        thumbGenRunning = false;
        setStatus('已生成 ' + n + ' 个缩略图。' +
          (n < rows.length
            ? '其余模型无法生成，请确认模型能在 Creo 中正常打开。'
            : '预览已缓存到 work\\thumbs。'),
          n ? 'ok' : 'warn');
      })
      .catch(function (err) {
        thumbGenRunning = false;
        setStatus('生成缩略图失败：' +
          (err && err.message ? err.message : err) +
          '。可先用“加载缩略图”重试。', 'err');
      });
  }

  function loadThumbnails(manual) {
    if (!state.bomRows.length) {
      notify('产品BOM为空，先“从 Creo 生成 BOM”或添加行。');
      return;
    }
    thumbGenAllowed = !!manual;
    setStatus('正在读取模型内嵌预览…', 'info');
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 30000) : null;
    fetch(BRIDGE + '/assembly/info', { signal: ctrl ? ctrl.signal : undefined })
      .then(function (res) {
        return res.text().then(function (t) { return { res: res, text: t }; });
      })
      .then(function (o) {
        if (timer) clearTimeout(timer);
        var d = null;
        try { d = JSON.parse(o.text); } catch (e) { }
        if (!o.res.ok || !d || d.ok === false) {
          throw new Error((d && (d.error || d.message)) || ('HTTP ' + o.res.status));
        }
        var dir = d.dir ? String(d.dir) : '';
        if (!dir && d.path) dir = String(d.path).replace(/[\\\/][^\\\/]+$/, '');
        if (!dir && state.bomMeta && state.bomMeta.assemblyPath) {
          dir = String(state.bomMeta.assemblyPath).replace(/[\\\/][^\\\/]+$/, '');
        }
        bomThumbDir = dir;
        var map = {};
        (d.items || []).forEach(function (it) {
          [it.file, it.name].forEach(function (k) {
            k = String(k || '').toLowerCase();
            if (k && !map[k]) map[k] = it;
          });
        });
        var count = applyThumbnails(map, dir);
        if (manual) {
          setStatus('已匹配 ' + count + ' 行缩略图，正在检查模型预览…', 'info');
          setTimeout(scheduleThumbGenerate, 900);
        } else {
          setStatus('已匹配 ' + count + ' 行缩略图，正在检查模型预览…', 'info');
          setTimeout(loadCachedThumbs, 1100);
          setTimeout(settleThumbStatus, 1800);
        }
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        var dir = '';
        if (state.bomMeta && state.bomMeta.assemblyPath) {
          dir = String(state.bomMeta.assemblyPath).replace(/[\\\/][^\\\/]+$/, '');
        }
        bomThumbDir = dir;
        var count = applyThumbnails({}, dir);
        if (count) {
          if (manual) {
            setStatus('已按已保存路径/文件名匹配 ' + count + ' 行缩略图，' +
              '正在检查模型预览…', 'info');
            setTimeout(scheduleThumbGenerate, 900);
          } else {
            setStatus('已按已保存路径/文件名匹配 ' + count + ' 行缩略图，' +
              '正在检查模型预览…', 'info');
            setTimeout(loadCachedThumbs, 1100);
            setTimeout(settleThumbStatus, 1800);
          }
        } else {
          setStatus('加载缩略图失败：' +
            (err && err.message ? err.message : err) +
            '。请确认 CreoBridge 正在运行，且 BOM 行带有模型文件名。', 'err');
        }
      });
  }

  function fillOutlinesFromCreo() {
    if (!state.bomRows.length) {
      notify('产品BOM为空，先“从 Creo 生成 BOM”或添加行。');
      return;
    }
    setStatus('正在从 Creo 读取轮廓尺寸和单重…', 'info');
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 60000) : null;
    fetch(BRIDGE + '/assembly/info', { signal: ctrl ? ctrl.signal : undefined })
      .then(function (res) {
        return res.text().then(function (t) { return { res: res, text: t }; });
      })
      .then(function (o) {
        if (timer) clearTimeout(timer);
        var d = null;
        try { d = JSON.parse(o.text); } catch (e) { }
        if (!o.res.ok || !d || d.ok === false) {
          throw new Error((d && (d.error || d.message)) || ('HTTP ' + o.res.status));
        }
        var items = d.items || [];
        var map = {};
        items.forEach(function (it) {
          [it.file, it.name].forEach(function (k) {
            k = String(k || '').toLowerCase();
            if (k && !map[k]) map[k] = it;
          });
        });
        var filled = 0;
        pushBomUndo();
        state.bomRows.forEach(function (r) {
          var it = map[String(r.file || '').toLowerCase()] ||
                   map[String(r.name || '').toLowerCase()];
          if (!it) return;
          if (!String(r.outline || '').trim() && it.size) {
            r.outline = fmtDims(it.size);
            filled++;
          }
          if (!(num(r.unitWeight) > 0) && num(it.mass) > 0) {
            r.unitWeight = massToGram(it.mass, it.density);
            filled++;
          }
        });
        renderBomTable();
        saveBom();
        setStatus('已从 Creo 填充 ' + filled + ' 项轮廓尺寸/单重。', 'ok');
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        setStatus('读取轮廓尺寸失败：' + (err && err.message ? err.message : err) +
          '。请确认 Creo 已打开装配体，且 CreoBridge 正在运行。', 'err');
      });
  }

  function splitLine(line, sep) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (q) {
        if (ch === '"') {
          if (line.charAt(i + 1) === '"') { cur += '"'; i++; }
          else q = false;
        } else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }

  function pick(o, keys) {
    for (var i = 0; i < keys.length; i++) {
      if (o[keys[i]] !== undefined && o[keys[i]] !== null) return o[keys[i]];
    }
    return '';
  }

  function surfaceKeyFrom(v) {
    var s = String(v || '').trim();
    if (!s || s === '无') return 'none';
    if (typeof SURFACES !== 'undefined') {
      for (var i = 0; i < SURFACES.length; i++) {
        if (SURFACES[i].key === s || SURFACES[i].name === s) return SURFACES[i].key;
      }
    }
    return s;
  }

  function finishKeyFrom(v) {
    var s = String(v || '').trim();
    if (/哑光/.test(s)) return 'matte';
    if (/亮光/.test(s)) return 'gloss';
    if (/砂纹/.test(s)) return 'sand';
    if (/橘皮/.test(s)) return 'orange';
    if (/拉丝/.test(s)) return 'brushed';
    if (/抛丸/.test(s)) return 'shot';
    if (/100\s*目/.test(s)) return 'sand100';
    if (/120\s*目/.test(s)) return 'sand120';
    if (/镜面/.test(s)) return 'mirror';
    return s || 'none';
  }

  function normRow(o) {
    var kind = String(pick(o, ['kind', '类别']) || '零件');
    if (/组件|装配/.test(kind)) kind = '组件';
    else if (/标准/.test(kind)) kind = '标准件';
    else if (/外购/.test(kind)) kind = '外购件';
    else kind = '零件';
    var drawn = String(pick(o, ['drawn', '已出图']) || 'N').toUpperCase();
    return {
      id: uid(),
      level: String(pick(o, ['level', '层级']) || '0'),
      kind: kind,
      name: String(pick(o, ['name', '名称']) || ''),
      material: String(pick(o, ['material', '材料']) || ''),
      surface: surfaceKeyFrom(pick(o, ['surface', '表面处理'])),
      color: String(pick(o, ['color', '颜色']) || ''),
      finish: finishKeyFrom(pick(o, ['finish', '表面效果'])),
      qty: num(pick(o, ['qty', '数量'])) || 1,
      unitWeight: num(pick(o, ['unitWeight', '单重'])),
      drawn: drawn.charAt(0) === 'Y' ? 'Y' : 'N',
      outline: String(pick(o, ['outline', '轮廓尺寸']) || ''),
      remark: String(pick(o, ['remark', '备注']) || ''),
      manual: !!o.manual,
      locked: !!o.locked
    };
  }

  function parseBomText(text) {
    text = String(text || '').replace(/^\uFEFF/, '').trim();
    if (!text) return [];
    if (text.charAt(0) === '[' || text.charAt(0) === '{') {
      var data = JSON.parse(text);
      var arr = Array.isArray(data) ? data : (data.rows || data.items || []);
      return arr.map(normRow);
    }
    var lines = text.replace(/\r/g, '').split('\n').filter(function (l) {
      return l.trim().length > 0;
    });
    if (!lines.length) return [];
    var sep = lines[0].indexOf('\t') >= 0 ? '\t' : ',';
    var first = splitLine(lines[0], sep);
    var header = false;
    for (var i = 0; i < first.length; i++) {
      if (/序号|层级|类别|名称|材料|数量|单重|总重|已出图|轮廓/.test(first[i])) {
        header = true;
        break;
      }
    }
    var idx = {
      level: -1, kind: -1, name: -1, material: -1, surface: -1, color: -1,
      finish: -1, qty: -1, unitWeight: -1, drawn: -1, outline: -1, remark: -1
    };
    if (header) {
      first.forEach(function (h, n) {
        var s = String(h).replace(/\s/g, '');
        if (/层级/.test(s)) idx.level = n;
        else if (/类别/.test(s)) idx.kind = n;
        else if (/名称|零件名/.test(s)) idx.name = n;
        else if (/材料/.test(s)) idx.material = n;
        else if (/表面处理|表面/.test(s)) idx.surface = n;
        else if (/颜色/.test(s)) idx.color = n;
        else if (/表面效果|效果/.test(s)) idx.finish = n;
        else if (/数量/.test(s)) idx.qty = n;
        else if (/单重/.test(s)) idx.unitWeight = n;
        else if (/已出图/.test(s)) idx.drawn = n;
        else if (/轮廓/.test(s)) idx.outline = n;
        else if (/备注/.test(s)) idx.remark = n;
      });
    } else {
      idx.level = 1; idx.kind = 2; idx.name = 3; idx.material = 4;
      idx.qty = 5; idx.unitWeight = 6; idx.drawn = 8; idx.outline = 9;
    }
    var rows = [];
    var start = header ? 1 : 0;
    for (var n = start; n < lines.length; n++) {
      var c = splitLine(lines[n], sep);
      if (!c.length) continue;
      var name = idx.name >= 0 ? c[idx.name] : '';
      if (!String(name || '').trim()) continue;
      rows.push(normRow({
        level: idx.level >= 0 ? c[idx.level] : '0',
        kind: idx.kind >= 0 ? c[idx.kind] : '零件',
        name: name,
        material: idx.material >= 0 ? c[idx.material] : '',
        surface: idx.surface >= 0 ? c[idx.surface] : 'none',
        color: idx.color >= 0 ? c[idx.color] : '',
        finish: idx.finish >= 0 ? c[idx.finish] : 'none',
        qty: idx.qty >= 0 ? c[idx.qty] : 1,
        unitWeight: idx.unitWeight >= 0 ? c[idx.unitWeight] : 0,
        drawn: idx.drawn >= 0 ? c[idx.drawn] : 'N',
        outline: idx.outline >= 0 ? c[idx.outline] : '',
        remark: idx.remark >= 0 ? c[idx.remark] : ''
      }));
    }
    return rows;
  }

  function readFile(file, label) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var rows = parseBomText(reader.result);
        if (!rows.length) throw new Error('没有解析到 BOM 行');
        pushBomUndo();
      state.bomRows = rows;
      bomThumbs = {};
        state.bomMeta.template = label;
        renderBomTable();
        saveBom();
        setStatus('已加载 ' + label + '：' + rows.length + ' 行。', '');
      } catch (e) {
        setStatus('加载失败：' + String(e.message || e) +
          '（支持 CSV / JSON；Excel 请先另存为 CSV）', 'err');
      }
    };
    reader.readAsText(file, 'UTF-8');
  }

  function csvCell(v) {
    var s = String(v === undefined || v === null ? '' : v);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function dateStamp() {
    var d = new Date();
    function p(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
  }

  function exportBom() {
    if (!state.bomRows.length) { notify('产品BOM为空，没有可导出的内容。'); return; }
    var lines = ['序号,层级,类别,名称,材料,表面处理,表面效果,颜色,数量,单重,总重,已出图,轮廓尺寸,备注'];
    state.bomRows.forEach(function (r, i) {
      lines.push([
        i + 1, r.level, r.kind, r.name, r.material,
        surfaceName(r.surface || 'none'),
        finishName(r.finish || 'none'),
        r.color || '',
        num(r.qty), num(r.unitWeight), rowTotal(r).toFixed(2),
        r.drawn, r.outline, r.remark || ''
      ].map(csvCell).join(','));
    });
    var blob = new Blob(['\uFEFF' + lines.join('\r\n')], {
      type: 'text/csv;charset=utf-8'
    });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '产品BOM表_' + dateStamp() + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    setStatus('已导出产品BOM表（CSV，Excel 可直接打开）。', '');
  }

  function loadBomLogo(cb) {
    ensure();
    var logo = state.bomMeta.logo || '';
    if (logo && logo.indexOf('data:') === 0) { cb(logo); return; }
    try {
      fetch('logo.png').then(function (r) { return r.blob(); }).then(function (b) {
        var fr = new FileReader();
        fr.onload = function () { cb(String(fr.result || '')); };
        fr.onerror = function () { cb(''); };
        fr.readAsDataURL(b);
      }).catch(function () { cb(''); });
    } catch (e) { cb(''); }
  }

  function exportBomExcel() {
    if (!state.bomRows.length) { notify('产品BOM为空，没有可导出的内容。'); return; }
    ensure();
    loadBomLogo(function (logo) {
      var m = state.bomMeta;
      var qty = 0, weight = 0;
      var body = '';
      state.bomRows.forEach(function (r, i) {
        var t = rowTotal(r);
        qty += num(r.qty);
        weight += t;
        var surface = surfaceName(r.surface || 'none');
        body += '<tr class="bomrow">' +
          '<td class="c">' + (i + 1) + '</td>' +
          '<td class="c">' + esc(r.level) + '</td>' +
          '<td class="c">' + esc(r.kind) + '</td>' +
          '<td class="l">' + esc(r.name) + '</td>' +
          '<td class="l">' + esc(r.material || '') + '</td>' +
          '<td class="l">' + esc(surface) + '</td>' +
          '<td class="l">' + esc(finishName(r.finish || 'none')) + '</td>' +
          '<td class="c">' + esc(r.color || '') + '</td>' +
          '<td class="c">' + num(r.qty) + '</td>' +
          '<td class="n">' + (num(r.unitWeight) ? num(r.unitWeight).toFixed(2) : '') + '</td>' +
          '<td class="n">' + (t > 0 ? t.toFixed(2) : '') + '</td>' +
          '<td class="c">' + esc(r.drawn) + '</td>' +
          '<td class="l">' + esc(r.outline || '') + '</td>' +
          '<td class="l">' + esc(r.remark || '') + '</td>' +
          '</tr>';
      });

      var revs = (m.revisions || []).slice();
      if (!revs.length) {
        revs.push({ version: m.version || 'A', date: m.modifiedDate || '',
          content: '首次发布', prepared: m.preparedBy || '', reviewed: m.reviewedBy || '' });
      }
      var revHtml = revs.map(function (r) {
        return '<tr><td colspan="2" class="c">' + esc(r.version || '') + '</td>' +
          '<td colspan="2" class="c">' + esc(r.date || '') + '</td>' +
          '<td colspan="5" class="l">' + esc(r.content || '版本更新') + '</td>' +
          '<td colspan="2" class="c">' + esc(r.prepared || '') + '</td>' +
          '<td colspan="3" class="c">' + esc(r.reviewed || '') + '</td></tr>';
      }).join('');

      var proj = ($('projName') && $('projName').value) || '';
      var customer = ($('projCustomer') && $('projCustomer').value) || '';

      var html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" ' +
        'xmlns:x="urn:schemas-microsoft-com:office:excel" ' +
        'xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8">' +
        '<title>' + esc(m.docName || '产品 BOM') + '</title>' +
        '<style>' +
        '@page{size:A4 landscape;margin:8mm;mso-page-orientation:landscape}' +
        'body{font-family:"Microsoft YaHei","SimSun";font-size:8.5pt;color:#111;margin:0}' +
        'table.doc{width:100%;border-collapse:collapse;table-layout:fixed}' +
        'table.doc td,table.doc th{border:1px solid #333;padding:2pt 3pt;' +
        'font-size:8.5pt;vertical-align:middle;word-wrap:break-word;overflow:hidden}' +
        '.logo{text-align:center;font-weight:bold;color:#888;padding:0!important}' +
        '.logo img{display:block;margin:0 auto}' +
        'table.doc td.company{font-size:14pt;font-weight:bold;text-align:center}' +
        'table.doc td.title{font-size:16pt;font-weight:bold;text-align:center;height:26pt}' +
        'table.doc td.lbl{background:#f2f2f2;font-weight:bold;text-align:center;font-size:8pt}' +
        '.v{padding-left:6px}' +
        'table.doc tr.cols th{background:#d9e2f3;font-weight:bold;text-align:center;' +
        'height:22pt;font-size:8pt}' +
        '.c{text-align:center}.l{text-align:left}' +
        '.n{text-align:right;mso-number-format:"0.00"}' +
        '.bomrow td{height:15pt}' +
        'table.doc tr.total td{background:#f2f2f2;font-weight:bold}' +
        'table.doc td.sec{background:#d9e2f3;font-weight:bold;text-align:center;' +
        'font-size:9pt;height:18pt}' +
        'table.doc tr.revhead th{background:#f2f2f2;font-weight:bold;text-align:center;font-size:8pt}' +
        'table.doc tr.sign td{border:none;border-top:1px solid #333;padding:6pt 4pt;' +
        'text-align:left;font-size:8pt}' +
        '</style></head><body>' +
        '<table class="doc">' +
        '<colgroup>' +
        '<col width="38" style="width:28.5pt"><col width="42" style="width:31.5pt">' +
        '<col width="56" style="width:42pt"><col width="210" style="width:157.5pt">' +
        '<col width="88" style="width:66pt"><col width="76" style="width:57pt">' +
        '<col width="68" style="width:51pt"><col width="54" style="width:40.5pt">' +
        '<col width="46" style="width:34.5pt"><col width="60" style="width:45pt">' +
        '<col width="60" style="width:45pt"><col width="50" style="width:37.5pt">' +
        '<col width="112" style="width:84pt"><col width="92" style="width:69pt">' +
        '</colgroup>' +
        '<tr><td colspan="14" class="title">产品BOM物料清单</td></tr>' +
        '<tr><td colspan="2" class="lbl">客户名称</td>' +
          '<td colspan="4" class="v">' + esc(customer) + '</td>' +
          '<td colspan="2" class="lbl">产品名称</td>' +
          '<td colspan="6" class="v">' + esc(m.productName || '') + '</td></tr>' +
        '<tr><td colspan="2" class="lbl">产品型号</td>' +
          '<td colspan="4" class="v">' + esc(m.productModel || '') + '</td>' +
          '<td colspan="2" class="lbl">项目</td>' +
          '<td colspan="6" class="v">' + esc(proj) + '</td></tr>' +
        '<tr><td colspan="2" class="lbl">版本</td>' +
          '<td colspan="2" class="v">' + esc(m.version || 'A') + '</td>' +
          '<td colspan="2" class="lbl">编制日期</td>' +
          '<td colspan="2" class="v">' + esc(m.preparedDate || '') + '</td>' +
          '<td colspan="2" class="lbl">修改日期</td>' +
          '<td colspan="4" class="v">' + esc(m.modifiedDate || '') + '</td></tr>' +
        '<tr class="cols">' +
          '<th>序号</th><th>层级</th><th>类别</th><th>名称</th>' +
          '<th>材料</th><th>表面处理</th><th>表面效果</th><th>颜色</th>' +
          '<th>数量</th><th>单重(g)</th><th>总重(g)</th><th>已出图</th>' +
          '<th>轮廓尺寸</th><th>备注</th></tr>' +
        body +
        '<tr class="total"><td colspan="4" class="l">合计</td>' +
          '<td colspan="4"></td>' +
          '<td class="c">' + qty + '</td><td></td>' +
          '<td class="n">' + (weight > 0 ? (weight / 1000).toFixed(3) + ' kg' : '') + '</td>' +
          '<td colspan="3"></td></tr>' +
        '<tr><td colspan="14" class="sec">修改记录</td></tr>' +
        '<tr class="revhead"><th colspan="2">版本</th><th colspan="2">日期</th>' +
          '<th colspan="5">修改内容</th><th colspan="2">编制</th>' +
          '<th colspan="3">审核</th></tr>' +
        revHtml +
        '<tr class="sign"><td colspan="3">编制：' + esc(m.preparedBy || '') + '</td>' +
          '<td colspan="3">校对：' + esc(m.checkedBy || '') + '</td>' +
          '<td colspan="4">审核：' + esc(m.reviewedBy || '') + '</td>' +
          '<td colspan="4">日期：' + esc(m.modifiedDate || '') + '</td></tr>' +
        '</table></body></html>';

      var blob = new Blob(['\ufeff' + html], {
        type: 'application/vnd.ms-excel;charset=utf-8'
      });
      var name = String(m.docName || '产品BOM').replace(/[\\/:*?"<>|]/g, '_');
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'BOM_' + name + '_' + dateStamp() + '.xls';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      setStatus('已导出正式 BOM（Excel .xls，含抬头、审批和修改记录）。', 'ok');
    });
  }

  function showSummary() {
    if (!state.bomRows.length) { notify('产品BOM为空。'); return; }
    var map = {};
    state.bomRows.forEach(function (r) {
      var k = String(r.material || '未填材料');
      if (!map[k]) map[k] = { lines: 0, qty: 0, weight: 0 };
      map[k].lines++;
      map[k].qty += num(r.qty);
      map[k].weight += rowTotal(r);
    });
    var html = '<div class="sechead">零件汇总（按材料）</div>' +
      '<div class="tablewrap"><table><thead><tr>' +
      '<th>材料</th><th>行数</th><th>总数量</th><th>总重</th>' +
      '</tr></thead><tbody>';
    Object.keys(map).forEach(function (k) {
      var v = map[k];
      html += '<tr><td>' + esc(k) + '</td><td>' + v.lines + '</td><td>' +
        v.qty + '</td><td>' + (v.weight / 1000).toFixed(2) + ' kg</td></tr>';
    });
    html += '</tbody></table></div>';
    $('bomSummaryOut').innerHTML = html;
    setStatus('已按材料汇总。', '');
  }

  function estimateMaterialPrice(mat) {
    var s = String(mat || '').toUpperCase();
    if (/AL6061|AL6063|AL5052|AL7075|AL|6061|6063|7075|5052/.test(s)) return 25;
    if (/SUS316|316/.test(s)) return 26;
    if (/SUS304|304/.test(s)) return 18;
    if (/BRASS|黄铜|CU|铜/.test(s)) return 60;
    if (/POM|PA6|PA66|NYLON|ABS|PP|PE|PC|PVC|PMMA/.test(s)) return 20;
    if (/RUBBER|橡胶|硅胶|SILICONE/.test(s)) return 35;
    if (/HT|QT|ZG|STEEL|Q235|45#|S45C|SPCC/.test(s)) return 6;
    return 15;
  }

  function toQuote() {
    ensure();
    var items = state.bomRows.filter(function (r) {
      return r.name && r.kind !== '组件';
    });
    if (!items.length) {
      items = state.bomRows.filter(function (r) { return r.name; });
    }
    if (!items.length) { notify('BOM 里没有可导入的零件。'); return; }
    if (!confirm('将 ' + items.length + ' 行 BOM 导入报价明细？')) return;
    var added = 0;
    items.forEach(function (b) {
      var q = newRow('bomitem');
      q.name = b.name;
      var surfName = surfaceName(b.surface || 'none');
      q.spec = [b.material, surfName, finishName(b.finish || 'none'),
        b.color, b.outline, b.remark].filter(Boolean).join(' · ');
      q.qty = num(b.qty) || 1;
      q.unit = '件';
      q.p.unitWeightG = num(b.unitWeight);
      q.p.matPrice = estimateMaterialPrice(b.material);
      q.p.processCost = num(b.unitWeight) > 0
        ? Math.round(num(b.unitWeight) / 1000 * 20 * 100) / 100 : 0;
      q.p.surfaceCost = (b.surface && b.surface !== 'none') ? 5 : 0;
      q.remark = 'BOM导入 · 层级 ' + b.level;
      state.rows.push(q);
      added++;
    });
    save();
    if (typeof render === 'function') render();
    switchView('quote');
    notify('已导入 ' + added + ' 行到报价明细，可按品类/工艺继续调整。');
  }

  function switchView(mode) {
    document.body.classList.toggle('view-bom', mode === 'bom');
    document.body.classList.toggle('view-quote', mode === 'quote');
    if ($('tabBom')) $('tabBom').classList.toggle('active', mode === 'bom');
    if ($('tabQuote')) $('tabQuote').classList.toggle('active', mode === 'quote');
    if (mode === 'quote') {
      if (typeof quoteInit === 'function') quoteInit();
      if (typeof syncQuoteHeaderFromState === 'function') syncQuoteHeaderFromState();
      if (typeof render === 'function') render();
    } else {
      renderBomTable();
    }
  }

  function bind() {
    if ($('tabBom')) $('tabBom').onclick = function () { switchView('bom'); };
    if ($('tabQuote')) $('tabQuote').onclick = function () { switchView('quote'); };
    function saveBomFile() {
    var data = { meta: state.bomMeta || {}, rows: state.bomRows || [] };
    setStatus('正在保存 BOM 到当前三维模型目录…', 'info');
    fetch(BRIDGE + '/bom/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        json: JSON.stringify(data, null, 2),
        name: ''
      })
    })
      .then(function (res) {
        return res.text().then(function (t) { return { res: res, text: t }; });
      })
      .then(function (o) {
        var d = null;
        try { d = JSON.parse(o.text); } catch (e) { }
        if (!o.res.ok || !d || d.ok === false) {
          throw new Error((d && (d.error || d.message)) ||
            ('HTTP ' + o.res.status));
        }
        setStatus('BOM 已保存到当前三维模型目录：' + d.path, 'ok');
      })
      .catch(function (err) {
        setStatus('保存 BOM 失败：' +
          (err && err.message ? err.message : err), 'err');
      });
  }

  function loadBomFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var d = null;
      try { d = JSON.parse(reader.result); } catch (e) { }
      if (!d || !Array.isArray(d.rows)) {
        setStatus('BOM 文件格式不正确：缺少 rows 数组。', 'err');
        return;
      }
      pushBomUndo();
      state.bomMeta = d.meta || { template: '导入BOM' };
      state.bomRows = d.rows;
      bomThumbs = {};
      ensure();
      renderBomTable();
      syncBomDocHead();
      saveBom();
      setStatus('已加载 BOM 文件：' + state.bomRows.length + ' 行。', 'ok');
    };
    reader.readAsText(file, 'UTF-8');
  }

  if ($('bomAdd')) $('bomAdd').onclick = addRow;
  if ($('bomSaveFile')) $('bomSaveFile').onclick = saveBomFile;
  if ($('bomLoadFile')) {
    $('bomLoadFile').onclick = function () { if ($('bomFile')) $('bomFile').click(); };
  }
  if ($('bomFile')) {
    $('bomFile').onchange = function () {
      if (this.files && this.files[0]) loadBomFile(this.files[0]);
      this.value = '';
    };
  }
    if ($('bomAdd2')) $('bomAdd2').onclick = addRow;
    if ($('bomDemo')) $('bomDemo').onclick = loadDemo;
    if ($('bomDemo2')) $('bomDemo2').onclick = loadDemo;
    if ($('bomClear')) $('bomClear').onclick = clearBom;
    if ($('bomPickAll')) {
      $('bomPickAll').onchange = function () { setAllPicked(this.checked); };
    }
    if ($('bomLock')) {
      $('bomLock').onclick = function () { toggleRowLocks(actionRowIds()); };
    }
    if ($('bomBatchDel')) $('bomBatchDel').onclick = batchDeleteRows;
    if ($('bomCreo')) $('bomCreo').onclick = importFromCreoBom;
    if ($('bomDepth')) {
      var savedDepth = state.bomMeta && state.bomMeta.assemblyDepth;
      if (savedDepth !== undefined && savedDepth !== null && savedDepth !== '') {
        var sd = String(savedDepth);
        if (['0', '1', '2', '3', '4', '5'].indexOf(sd) >= 0) {
          $('bomDepth').value = sd;
        } else {
          // 保存的是 6..12 层的自定义值，回填到“自定义…”输入框。
          $('bomDepth').value = 'custom';
          if ($('bomDepthCustom')) $('bomDepthCustom').value = sd;
        }
      }
      syncBomDepthCustom();
      $('bomDepth').onchange = function () {
        syncBomDepthCustom();
        state.bomMeta.assemblyDepth = bomDepthValue();
        saveBom();
      };
      if ($('bomDepthCustom')) {
        $('bomDepthCustom').oninput = function () {
          state.bomMeta.assemblyDepth = bomDepthValue();
          saveBom();
        };
      }
    }
    if ($('bomLoadE')) $('bomLoadE').onclick = function () { $('bomFileE').click(); };
    if ($('bomLoadP')) $('bomLoadP').onclick = function () { $('bomFileP').click(); };
    if ($('bomFileE')) $('bomFileE').onchange = function () { readFile(this.files[0], 'E-Bom'); this.value = ''; };
    if ($('bomFileP')) $('bomFileP').onchange = function () { readFile(this.files[0], 'P-Bom'); this.value = ''; };
    if ($('bomExport')) $('bomExport').onclick = exportBomExcel;
    if ($('bomSummary')) $('bomSummary').onclick = showSummary;
    if ($('bomOutline')) {
      $('bomOutline').onclick = fillOutlinesFromCreo;
    }
    if ($('bomUndo')) $('bomUndo').onclick = undoBom;
    if ($('bomRedo')) $('bomRedo').onclick = redoBom;
    if ($('bomThumb')) {
      $('bomThumb').onclick = function () { loadThumbnails(true); };
    }
    if ($('bomToQuote')) $('bomToQuote').onclick = toQuote;
    if ($('bomTemplate')) {
      $('bomTemplate').onchange = function () {
        state.bomMeta.template = this.value === 'blank' ? '空白模板' : '常用（默认）';
        if (this.value === 'blank') {
          if (state.bomRows.length && !confirm('清空当前产品BOM？')) {
            this.value = state.bomRows.length ? 'common' : 'blank';
            return;
          }
          pushBomUndo();
          state.bomRows = [];
          bomThumbs = {};
        } else if (!state.bomRows.length) {
          pushBomUndo();
          state.bomRows = demoRows();
          bomThumbs = {};
        }
        renderBomTable();
        syncBomDocHead();
        saveBom();
      };
    }
    var metaFields = [
      ['bomCompany', 'company'], ['bomDocName', 'docName'],
      ['bomProductName', 'productName'], ['bomProductModel', 'productModel'],
      ['bomPreparedBy', 'preparedBy'], ['bomCheckedBy', 'checkedBy'],
      ['bomReviewedBy', 'reviewedBy'], ['bomVersion', 'version'],
      ['bomPreparedDate', 'preparedDate'], ['bomModifiedDate', 'modifiedDate']
    ];
    metaFields.forEach(function (pair) {
      var el = $(pair[0]);
      if (!el) return;
      el.addEventListener('focus', markBomEditStarted);
      el.addEventListener('input', function () {
        state.bomMeta[pair[1]] = el.value;
        markBomEditChanged();
        updateDocStamp();
        saveBom();
        if (pair[1] === 'company') {
          var qc = $('quoteCompany');
          if (qc) qc.value = el.value;
        }
        if (pair[1] === 'modifiedDate') {
          var qd = $('quoteDateShow');
          if (qd) qd.textContent = el.value || '—';
        }
      });
    });
    if ($('bomLogoFile')) {
      $('bomLogoFile').onchange = function () {
        var f = this.files && this.files[0];
        this.value = '';
        if (!f) return;
        pushBomUndo();
        var reader = new FileReader();
        reader.onload = function () {
          state.bomMeta.logo = String(reader.result || '');
          var img = $('bomLogo');
          if (img) img.src = state.bomMeta.logo || 'logo.png';
          var qimg = $('quoteLogo');
          if (qimg) qimg.src = state.bomMeta.logo || 'logo.png';
          saveBom();
          setStatus('已更换 BOM LOGO。', 'ok');
        };
        reader.readAsDataURL(f);
      };
    }
    if ($('bomAddRev')) $('bomAddRev').onclick = addRevisionRow;
    if ($('bomRevRows')) {
      $('bomRevRows').addEventListener('focusin', function (e) {
        if (e.target && e.target.tagName === 'INPUT') markBomEditStarted();
      });
      $('bomRevRows').addEventListener('input', syncRevisionInput);
      $('bomRevRows').addEventListener('click', function (e) {
        var b = e.target.closest('[data-revdel]');
        if (!b) return;
        deleteRevisionRow(parseInt(b.getAttribute('data-revdel'), 10));
      });
    }

    if ($('bomRows')) {
      $('bomRows').addEventListener('input', onInput);
      $('bomRows').addEventListener('change', onChange);
      $('bomRows').addEventListener('click', onClick);
      $('bomRows').addEventListener('focusin', function (e) {
        if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) {
          markBomEditStarted();
        }
      });
      $('bomRows').addEventListener('focusout', function () {
        bomEditSnap = null;
        bomEditPushed = false;
      });
    }
  }

  ensure();
  fillBomDatalists();
  if (/[?&]bomdemo=1/.test(location.search) && !state.bomRows.length) {
    state.bomRows = demoRows();
    state.bomMeta.template = '常用（默认）';
  }
  bind();
  renderBomTable();
  syncBomDocHead();
  if (state.bomRows.length &&
      state.bomRows.some(function (r) { return r.file || r.path; })) {
    setTimeout(function () { loadThumbnails(false); }, 800);
  }
  if ($('bomTemplate')) {
    $('bomTemplate').value = state.bomMeta.template === '空白模板' ? 'blank' : 'common';
  }
})();
