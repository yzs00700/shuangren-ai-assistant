'use strict';

/* ============================================================
   BOM 报价 · 地区费率库 / 网价同步
   ------------------------------------------------------------
   材料参考价 = 内置基价或期货网价折算 + 加工溢价，再乘地区系数。
   加工费、表面处理按地区人工/机台系数调整。
   所有数字都可以在“费率设置”里手工覆盖。
   ============================================================ */

var REGIONS = [
  { id: 'east',      name: '华东（上海/江苏/浙江）', labor: 1.10, material: 1.00 },
  { id: 'south',     name: '华南（广东/福建）',       labor: 1.00, material: 1.02 },
  { id: 'north',     name: '华北（北京/天津/山东）',   labor: 0.95, material: 0.98 },
  { id: 'central',   name: '华中（湖北/湖南/河南）',   labor: 0.90, material: 1.00 },
  { id: 'southwest', name: '西南（四川/重庆）',       labor: 0.88, material: 1.04 },
  { id: 'northeast', name: '东北（辽宁/吉林/黑龙江）', labor: 0.85, material: 1.05 },
  { id: 'northwest', name: '西北（陕西/甘肃）',       labor: 0.82, material: 1.06 }
];

/* 材料库：base 为未联网时的参考基价（元/kg）；link 为新浪期货代码，
   有网价时按 网价/1000 + premium 计算。 */
var MATERIALS = {
  plastic: [
    { key: 'ABS',      name: 'ABS',          density: 1.05, base: 12.8, link: null,  premium: 0 },
    { key: 'PP',       name: 'PP',           density: 0.91, base: 9.8,  link: 'PP0', premium: 1.5 },
    { key: 'PE',       name: 'PE',           density: 0.95, base: 9.4,  link: 'L0',  premium: 1.5 },
    { key: 'PVC',      name: 'PVC',          density: 1.38, base: 9.4,  link: 'V0',  premium: 1.2 },
    { key: 'PC',       name: 'PC',           density: 1.20, base: 24.0, link: null,  premium: 0 },
    { key: 'PCABS',    name: 'PC/ABS',       density: 1.13, base: 22.0, link: null,  premium: 0 },
    { key: 'PA6',      name: 'PA6',          density: 1.14, base: 26.0, link: null,  premium: 0 },
    { key: 'PA66',     name: 'PA66',         density: 1.15, base: 30.0, link: null,  premium: 0 },
    { key: 'POM',      name: 'POM',          density: 1.41, base: 22.0, link: null,  premium: 0 },
    { key: 'PMMA',     name: 'PMMA',         density: 1.19, base: 16.0, link: null,  premium: 0 },
    { key: 'PET',      name: 'PET',          density: 1.34, base: 23.0, link: null,  premium: 0 },
    { key: 'TPU',      name: 'TPU',          density: 1.14, base: 32.0, link: null,  premium: 0 },
    { key: 'HIPS',     name: 'HIPS',         density: 1.05, base: 10.3, link: null,  premium: 0 },
    { key: 'SILICONE', name: '硅橡胶',        density: 1.15, base: 45.0, link: null,  premium: 0 },
    { key: 'EPDM',     name: 'EPDM 三元乙丙', density: 1.15, base: 28.0, link: null,  premium: 0 },
    { key: 'NBR',      name: 'NBR 丁腈橡胶',  density: 1.20, base: 30.0, link: null,  premium: 0 },
    { key: 'PU',       name: '聚氨酯 PU',     density: 1.20, base: 30.0, link: null,  premium: 0 },
    { key: 'TPE',      name: 'TPE',          density: 1.10, base: 30.0, link: null,  premium: 0 },
    { key: 'TPV',      name: 'TPV',          density: 1.05, base: 35.0, link: null,  premium: 0 },
    { key: 'PS',       name: 'PS',           density: 1.05, base: 10.0, link: null,  premium: 0 },
    { key: 'ASA',      name: 'ASA',          density: 1.07, base: 22.0, link: null,  premium: 0 },
    { key: 'PBT',      name: 'PBT',          density: 1.31, base: 20.0, link: null,  premium: 0 },
    { key: 'PA12',     name: 'PA12',         density: 1.01, base: 65.0, link: null,  premium: 0 },
    { key: 'PPS',      name: 'PPS 聚苯硫醚',  density: 1.35, base: 55.0, link: null,  premium: 0 },
    { key: 'PEI',      name: 'PEI 聚醚酰亚胺', density: 1.27, base: 220.0, link: null, premium: 0 },
    { key: 'PEEK',     name: 'PEEK 聚醚醚酮', density: 1.30, base: 380.0, link: null, premium: 0 },
    { key: 'EVA',      name: 'EVA',          density: 0.94, base: 14.0, link: null,  premium: 0 }
  ],
  sheet: [
    { key: 'Q235',   name: 'Q235 冷轧板',   density: 7.85, base: 5.2,  link: 'RB0', premium: 2.5 },
    { key: 'Q355',   name: 'Q355 低合金板', density: 7.85, base: 5.6,  link: 'RB0', premium: 3.0 },
    { key: 'Q195',   name: 'Q195 冷轧板',   density: 7.85, base: 5.0,  link: 'RB0', premium: 2.3 },
    { key: 'SPHC',   name: 'SPHC 热轧板',   density: 7.85, base: 5.0,  link: 'RB0', premium: 2.3 },
    { key: 'CR',     name: '冷轧板 SPCC',   density: 7.85, base: 5.4,  link: 'RB0', premium: 2.8 },
    { key: 'DC01',   name: 'DC01 冷轧板',   density: 7.85, base: 5.4,  link: 'RB0', premium: 2.8 },
    { key: 'DC03',   name: 'DC03 冷轧板',   density: 7.85, base: 5.6,  link: 'RB0', premium: 3.0 },
    { key: 'GI',     name: '镀锌板',        density: 7.85, base: 6.0,  link: 'RB0', premium: 3.2 },
    { key: 'SECC',   name: 'SECC 电镀锌板', density: 7.85, base: 6.2,  link: 'RB0', premium: 3.4 },
    { key: 'SGCC',   name: 'SGCC 热镀锌板', density: 7.85, base: 6.0,  link: 'RB0', premium: 3.2 },
    { key: 'SPTE',   name: 'SPTE 马口铁',   density: 7.85, base: 6.5,  link: 'RB0', premium: 3.5 },
    { key: 'S304',   name: '304 不锈钢',    density: 7.93, base: 18.0, link: null,  premium: 0 },
    { key: 'SUS201', name: '201 不锈钢',    density: 7.93, base: 12.5, link: null,  premium: 0 },
    { key: 'SUS316L', name: '316L 不锈钢',  density: 7.98, base: 27.0, link: null,  premium: 0 },
    { key: 'AL5052', name: '5052 铝板',     density: 2.68, base: 24.0, link: 'AL0', premium: 7.5 },
    { key: 'AL6061', name: '6061 铝板',     density: 2.70, base: 28.0, link: 'AL0', premium: 9.0 },
    { key: 'AL1060', name: '1060 铝板',     density: 2.70, base: 21.0, link: 'AL0', premium: 5.0 },
    { key: 'AL5754', name: '5754 铝板',     density: 2.66, base: 26.0, link: 'AL0', premium: 8.0 },
    { key: 'H62',    name: 'H62 黄铜板',    density: 8.50, base: 75.0, link: 'CU0', premium: -32.0 },
    { key: 'T2',     name: 'T2 紫铜板',     density: 8.90, base: 105.0, link: 'CU0', premium: 3.0 },
    { key: 'TA1',    name: 'TA1 钛板',      density: 4.51, base: 120.0, link: null, premium: 0 },
    { key: '65Mn',   name: '65Mn 弹簧钢',   density: 7.85, base: 7.0,  link: 'RB0', premium: 3.5 }
  ],
  diecast: [
    /* 压铸铝合金 */
    { key: 'ADC10',  name: 'ADC10 压铸铝', density: 2.70, base: 18.0, link: 'AL0', premium: 4.5 },
    { key: 'ADC12',  name: 'ADC12 压铸铝', density: 2.70, base: 18.0, link: 'AL0', premium: 4.5 },
    { key: 'A360',   name: 'A360 压铸铝',  density: 2.63, base: 19.0, link: 'AL0', premium: 5.0 },
    { key: 'A380',   name: 'A380 压铸铝',  density: 2.71, base: 19.0, link: 'AL0', premium: 5.0 },
    { key: 'A413',   name: 'A413 压铸铝',  density: 2.65, base: 18.5, link: 'AL0', premium: 4.8 },
    /* 铸造铝合金 ZL 系列 */
    { key: 'ZL101',  name: 'ZL101 铸造铝', density: 2.68, base: 17.5, link: 'AL0', premium: 4.0 },
    { key: 'ZL101A', name: 'ZL101A 铸造铝', density: 2.68, base: 18.0, link: 'AL0', premium: 4.2 },
    { key: 'ZL102',  name: 'ZL102 铸造铝', density: 2.65, base: 17.5, link: 'AL0', premium: 4.0 },
    { key: 'ZL104',  name: 'ZL104 铸造铝', density: 2.65, base: 18.0, link: 'AL0', premium: 4.5 },
    { key: 'ZL105',  name: 'ZL105 铸造铝', density: 2.68, base: 18.5, link: 'AL0', premium: 4.8 },
    { key: 'ZL107',  name: 'ZL107 铸造铝', density: 2.65, base: 18.5, link: 'AL0', premium: 5.0 },
    { key: 'ZL109',  name: 'ZL109 铸造铝', density: 2.68, base: 19.0, link: 'AL0', premium: 5.2 },
    { key: 'ZL114A', name: 'ZL114A 铸造铝', density: 2.68, base: 20.0, link: 'AL0', premium: 6.0 },
    { key: 'ZL201',  name: 'ZL201 铸造铝', density: 2.78, base: 22.0, link: 'AL0', premium: 8.0 },
    { key: 'ZL301',  name: 'ZL301 铸造铝', density: 2.55, base: 21.0, link: 'AL0', premium: 7.0 },
    { key: 'ZL401',  name: 'ZL401 铸造铝', density: 2.90, base: 20.0, link: 'AL0', premium: 6.0 },
    /* 压铸锌合金 */
    { key: 'ZAMAK3', name: 'ZAMAK3 锌合金', density: 6.60, base: 22.0, link: 'ZN0', premium: 4.0 },
    { key: 'ZAMAK5', name: 'ZAMAK5 锌合金', density: 6.60, base: 22.5, link: 'ZN0', premium: 4.0 },
    { key: 'ZnAl4Cu1', name: 'ZnAl4Cu1 锌合金', density: 6.60, base: 22.5, link: 'ZN0', premium: 4.2 },
    /* 灰铸铁 */
    { key: 'HT150',  name: 'HT150 灰铸铁', density: 7.20, base: 4.5, link: 'RB0', premium: 1.5 },
    { key: 'HT200',  name: 'HT200 灰铸铁', density: 7.25, base: 4.8, link: 'RB0', premium: 1.8 },
    { key: 'HT250',  name: 'HT250 灰铸铁', density: 7.30, base: 5.2, link: 'RB0', premium: 2.0 },
    { key: 'HT300',  name: 'HT300 灰铸铁', density: 7.30, base: 5.8, link: 'RB0', premium: 2.2 },
    /* 球墨铸铁 */
    { key: 'QT400',  name: 'QT400-18 球墨铸铁', density: 7.10, base: 6.2, link: 'RB0', premium: 2.8 },
    { key: 'QT450',  name: 'QT450-10 球墨铸铁', density: 7.15, base: 6.5, link: 'RB0', premium: 3.0 },
    { key: 'QT500',  name: 'QT500-7 球墨铸铁',  density: 7.20, base: 6.8, link: 'RB0', premium: 3.2 },
    { key: 'QT600',  name: 'QT600-3 球墨铸铁',  density: 7.25, base: 7.2, link: 'RB0', premium: 3.5 },
    /* 铸钢 */
    { key: 'ZG200',  name: 'ZG200-400 铸钢', density: 7.80, base: 6.5, link: 'RB0', premium: 3.2 },
    { key: 'ZG270',  name: 'ZG270-500 铸钢', density: 7.80, base: 7.0, link: 'RB0', premium: 3.5 },
    { key: 'ZG310',  name: 'ZG310-570 铸钢', density: 7.80, base: 7.5, link: 'RB0', premium: 3.8 },
    { key: 'ZG45',   name: 'ZG45 铸钢',      density: 7.80, base: 7.0, link: 'RB0', premium: 3.5 },
    { key: 'ZG35CrMo', name: 'ZG35CrMo 铸钢', density: 7.85, base: 9.5, link: 'RB0', premium: 4.5 },
    { key: 'ZGMn13', name: 'ZGMn13 高锰钢', density: 7.80, base: 12.0, link: 'RB0', premium: 5.0 },
    /* 不锈钢铸件 */
    { key: 'ZG304',  name: '304 不锈钢铸件', density: 7.90, base: 28.0, link: null, premium: 0 },
    { key: 'ZG316',  name: '316 不锈钢铸件', density: 7.95, base: 38.0, link: null, premium: 0 },
    { key: 'ZG2205', name: '2205 双相钢铸件', density: 7.80, base: 55.0, link: null, premium: 0 },
    { key: 'ZG420',  name: '420 马氏体不锈钢铸件', density: 7.70, base: 25.0, link: null, premium: 0 },
    /* 铜合金铸件 */
    { key: 'ZCuSn10Zn2', name: 'ZCuSn10Zn2 锡青铜铸件', density: 8.80, base: 85.0, link: 'CU0', premium: -20.0 },
    { key: 'ZCuZn38',    name: 'ZCuZn38 黄铜铸件',      density: 8.50, base: 70.0, link: 'CU0', premium: -35.0 },
    { key: 'ZCuAl10Fe3', name: 'ZCuAl10Fe3 铝青铜铸件', density: 7.50, base: 80.0, link: 'CU0', premium: -25.0 },
    { key: 'ZCuSn6Zn6Pb3', name: 'ZCuSn6Zn6Pb3 锡青铜铸件', density: 8.80, base: 80.0, link: 'CU0', premium: -25.0 },
    /* 镁合金压铸 */
    { key: 'AZ91D',  name: 'AZ91D 镁合金压铸', density: 1.81, base: 28.0, link: null, premium: 0 },
    { key: 'AM60B',  name: 'AM60B 镁合金压铸', density: 1.80, base: 30.0, link: null, premium: 0 },
    { key: 'AZ31B',  name: 'AZ31B 镁合金',     density: 1.77, base: 32.0, link: null, premium: 0 }
  ],
  cnc: [
    { key: 'AL6061', name: '6061-T6 铝',   density: 2.70, base: 28.0, link: 'AL0', premium: 9.0 },
    { key: 'AL7075', name: '7075-T6 铝',   density: 2.81, base: 38.0, link: 'AL0', premium: 18.0 },
    { key: 'AL5083', name: '5083 铝',      density: 2.66, base: 30.0, link: 'AL0', premium: 11.0 },
    { key: 'S45C',   name: '45# 钢',       density: 7.85, base: 6.5,  link: 'RB0', premium: 2.8 },
    { key: 'S20C',   name: '20# 钢',       density: 7.85, base: 6.0,  link: 'RB0', premium: 2.5 },
    { key: 'S40Cr',  name: '40Cr 钢',      density: 7.85, base: 7.0,  link: 'RB0', premium: 3.2 },
    { key: 'S304',   name: '304 不锈钢',   density: 7.93, base: 18.0, link: null,  premium: 0 },
    { key: 'S316',   name: '316 不锈钢',   density: 7.98, base: 26.0, link: null,  premium: 0 },
    { key: 'S303',   name: '303 不锈钢',   density: 7.93, base: 20.0, link: null,  premium: 0 },
    { key: 'S420',   name: '420 不锈钢',   density: 7.75, base: 18.0, link: null,  premium: 0 },
    { key: 'S440C',  name: '440C 不锈钢',  density: 7.70, base: 25.0, link: null,  premium: 0 },
    { key: 'SKD11',  name: 'SKD11 模具钢', density: 7.85, base: 35.0, link: null,  premium: 0 },
    { key: 'DC53',   name: 'DC53 模具钢',  density: 7.85, base: 38.0, link: null,  premium: 0 },
    { key: 'H62',    name: 'H62 黄铜',     density: 8.50, base: 75.0, link: 'CU0', premium: -32.0 },
    { key: 'T2',     name: 'T2 紫铜',      density: 8.90, base: 105.0, link: 'CU0', premium: 3.0 },
    { key: 'TC4',    name: 'TC4 钛合金',   density: 4.51, base: 180.0, link: null, premium: 0 },
    { key: 'AZ31',   name: 'AZ31 镁合金',  density: 1.77, base: 35.0, link: null,  premium: 0 },
    { key: 'POM',    name: 'POM',          density: 1.41, base: 22.0, link: null,  premium: 0 },
    { key: 'PA6',    name: 'PA6',          density: 1.14, base: 26.0, link: null,  premium: 0 },
    { key: 'PEEK',   name: 'PEEK',         density: 1.30, base: 380.0, link: null, premium: 0 },
    { key: 'PMMA',   name: 'PMMA',         density: 1.19, base: 16.0, link: null,  premium: 0 }
  ],
  print3d: [
    { key: 'PLA',    name: 'PLA',          density: 1.24, base: 180, link: null, premium: 0 },
    { key: 'PETG',   name: 'PETG',         density: 1.27, base: 160, link: null, premium: 0 },
    { key: 'ABS',    name: 'ABS',          density: 1.05, base: 120, link: null, premium: 0 },
    { key: 'ASA',    name: 'ASA',          density: 1.07, base: 180, link: null, premium: 0 },
    { key: 'PC',     name: 'PC',           density: 1.20, base: 220, link: null, premium: 0 },
    { key: 'TPU',    name: 'TPU 柔性',     density: 1.14, base: 260, link: null, premium: 0 },
    { key: 'TPE',    name: 'TPE 柔性',     density: 1.10, base: 260, link: null, premium: 0 },
    { key: 'NYLON',  name: '尼龙 PA',      density: 1.14, base: 300, link: null, premium: 0 },
    { key: 'PA12',   name: 'PA12',         density: 1.01, base: 300, link: null, premium: 0 },
    { key: 'PA_CF',  name: '碳纤维尼龙',   density: 1.15, base: 450, link: null, premium: 0 },
    { key: 'PA_GF',  name: '玻纤尼龙',     density: 1.35, base: 350, link: null, premium: 0 },
    { key: 'PEEK',   name: 'PEEK',         density: 1.30, base: 800, link: null, premium: 0 },
    { key: 'HIPS',   name: 'HIPS',         density: 1.05, base: 120, link: null, premium: 0 },
    { key: 'RESIN',  name: '光敏树脂',     density: 1.15, base: 400, link: null, premium: 0 }
  ],
  profile: [
    { key: 'AL3030', name: '3030 铝型材', density: 2.70, base: 24.0, link: 'AL0', premium: 2.5, weightPerM: 0.9, wall: 2.86, area: 3.1, I: 2.8, W: 1.8 },
    { key: 'AL2020', name: '2020 铝型材', density: 2.70, base: 24.0, link: 'AL0', premium: 2.5, weightPerM: 0.4, wall: 2.25, area: 1.6, I: 0.7, W: 0.7 },
    { key: 'AL4040', name: '4040 铝型材', density: 2.70, base: 24.0, link: 'AL0', premium: 2.5, weightPerM: 1.5, wall: 3.88, area: 5.6, I: 9.1, W: 4.5 },
    { key: 'AL4545', name: '4545 铝型材', density: 2.70, base: 24.0, link: 'AL0', premium: 2.5, weightPerM: 1.6, wall: 3.62, area: 6.0, I: 11.7, W: 5.2 },
    { key: 'AL8080', name: '8080 铝型材', density: 2.70, base: 24.0, link: 'AL0', premium: 2.5, weightPerM: 4.9, wall: 6.16, area: 18.2, I: 132.1, W: 33.0 },
    { key: 'AL6063', name: '6063 自制型材', density: 2.70, base: 24.0, link: 'AL0', premium: 2.0, weightPerM: 1.0, wall: 0, area: 0, I: 0, W: 0 },
    { key: 'AL_CUSTOM', name: '自制铝型材（自定义）', density: 2.70, base: 24.0, link: 'AL0', premium: 2.0, weightPerM: 1.0, wall: 0, area: 0, I: 0, W: 0 }
  ],
  pcb: [
    { key: 'FR4', name: 'FR-4', density: 1.85, base: 45.0, link: null, premium: 0 },
    { key: 'FR4HTG', name: '高TG FR-4', density: 1.85, base: 58.0, link: null, premium: 0 },
    { key: 'CEM3', name: 'CEM-3', density: 1.80, base: 38.0, link: null, premium: 0 },
    { key: 'AL1060', name: '铝基板 1060', density: 2.70, base: 42.0, link: 'AL0', premium: 2.0 },
    { key: 'AL5052', name: '铝基板 5052', density: 2.68, base: 46.0, link: 'AL0', premium: 2.0 },
    { key: 'FPC', name: 'FPC 柔性板', density: 1.40, base: 120.0, link: null, premium: 0 }
  ]
};

var PROCESSES = [
  { key: 'plasticMachine', name: '注塑机时费', unit: '元/小时', base: 45 },
  { key: 'diecastMachine', name: '铸造机时费', unit: '元/小时', base: 120 },
  { key: 'cncMachine',     name: 'CNC 机时费', unit: '元/小时', base: 80 },
  { key: 'printMachine',   name: '3D 打印机时费', unit: '元/小时', base: 15 },
  { key: 'laser',          name: '激光/冲切', unit: '元/件', base: 3 },
  { key: 'bend',           name: '折弯', unit: '元/刀', base: 0.8 },
  { key: 'weld',           name: '焊接', unit: '元/件', base: 0 },
  { key: 'profileCut',     name: '型材切割', unit: '元/刀', base: 1.5 },
  { key: 'profileMachine', name: '型材钻孔/攻丝', unit: '元/件', base: 3 },
  { key: 'gravityCastMachine', name: '重力铸造机时费', unit: '元/小时', base: 60 },
  { key: 'sandCastMachine', name: '砂型铸造机时费', unit: '元/小时', base: 35 },
  { key: 'investmentCastMachine', name: '熔模铸造机时费', unit: '元/小时', base: 80 },
  { key: 'lowPressureCastMachine', name: '低压铸造机时费', unit: '元/小时', base: 90 }
];

/* 铸造工艺：选择后自动带出机时费、周期和去毛刺参考值。
   机时费仍走地区人工系数，可在“费率设置”里覆盖。 */
var CASTING_METHODS = [
  { key: 'diecast',     name: '压铸（高压）',       rateKey: 'diecastMachine',       cycleSec: 60,  deburr: 0.5 },
  { key: 'gravity',     name: '重力铸造',           rateKey: 'gravityCastMachine',   cycleSec: 180, deburr: 0.8 },
  { key: 'sand',        name: '砂型铸造',           rateKey: 'sandCastMachine',      cycleSec: 300, deburr: 1.2 },
  { key: 'investment',  name: '熔模铸造（失蜡）',   rateKey: 'investmentCastMachine', cycleSec: 240, deburr: 1.0 },
  { key: 'lowpressure', name: '低压铸造',           rateKey: 'lowPressureCastMachine', cycleSec: 120, deburr: 0.6 }
];

function castingMethodInfo(key) {
  for (var i = 0; i < CASTING_METHODS.length; i++) {
    if (CASTING_METHODS[i].key === key) return CASTING_METHODS[i];
  }
  return CASTING_METHODS[0];
}

/* 表面处理按“类型”分别定价，再乘地区人工/能耗系数。
   价格为常见中小批量参考值（元/件），可在费率设置里逐项覆盖。 */
var SURFACES = [
  { key: 'none',         name: '无',                 price: 0 },
  { key: 'powder',       name: '喷粉',               price: 8 },
  { key: 'paint',        name: '喷漆',               price: 6 },
  { key: 'anodize',      name: '阳极氧化',           price: 12 },
  { key: 'hardAnodize',  name: '硬质阳极氧化',       price: 20 },
  { key: 'plating',      name: '电镀（铬/镍）',      price: 10 },
  { key: 'zincPlate',    name: '镀锌',               price: 6 },
  { key: 'black',        name: '发黑',               price: 3 },
  { key: 'brush',        name: '拉丝',               price: 5 },
  { key: 'sandblast',    name: '喷砂',               price: 4 },
  { key: 'passivate',    name: '钝化',               price: 4 },
  { key: 'electrophoresis', name: '电泳',            price: 9 },
  { key: 'silkscreen',   name: '丝印',               price: 2 },
  { key: 'laserMark',    name: '激光打标',           price: 3 },
  { key: 'heatTreat',    name: '热处理',             price: 7 }
];

/* 有表面处理选项的品类 */
var SURFACE_CATS = { plastic: 1, sheet: 1, profile: 1, diecast: 1, cnc: 1, print3d: 1, fastener: 1 };

function regionById(id) {
  for (var i = 0; i < REGIONS.length; i++) {
    if (REGIONS[i].id === id) return REGIONS[i];
  }
  return REGIONS[0];
}

function regionInfo() {
  return regionById(state.rates && state.rates.region);
}

function materialList(cat) { return MATERIALS[cat] || []; }

function defaultMatKey(cat) {
  var list = materialList(cat);
  return list.length ? list[0].key : '';
}

function materialInfo(cat, key) {
  var list = materialList(cat);
  for (var i = 0; i < list.length; i++) {
    if (list[i].key === key) return list[i];
  }
  return list.length ? list[0] : null;
}

function marketValue(symbol) {
  var m = (state.rates && state.rates.market) || {};
  var v = Number(m[symbol]);
  return isFinite(v) ? v : 0;
}

function rateOverride(kind, key) {
  var bag = state.rates && state.rates[kind + 'Overrides'];
  if (!bag) return null;
  var v = bag[key];
  if (v === undefined || v === null || v === '') return null;
  v = Number(v);
  return isFinite(v) ? v : null;
}

function baseMaterialPrice(cat, key) {
  var m = materialInfo(cat, key);
  if (!m) return 0;
  var mv = m.link ? marketValue(m.link) : 0;
  if (mv > 0) return mv / 1000 + m.premium;
  return m.base;
}

function materialPrice(cat, key) {
  var ov = rateOverride('material', cat + ':' + (key || defaultMatKey(cat)));
  if (ov !== null) return ov;
  return baseMaterialPrice(cat, key) * regionInfo().material;
}

function processRate(key) {
  var ov = rateOverride('process', key);
  if (ov !== null) return ov;
  var base = 0;
  for (var i = 0; i < PROCESSES.length; i++) {
    if (PROCESSES[i].key === key) { base = PROCESSES[i].base; break; }
  }
  return base * regionInfo().labor;
}

function surfaceInfo(key) {
  for (var i = 0; i < SURFACES.length; i++) {
    if (SURFACES[i].key === key) return SURFACES[i];
  }
  return SURFACES[0];
}

function surfacePrice(key) {
  var ov = rateOverride('surface', key || 'none');
  if (ov !== null) return ov;
  return surfaceInfo(key || 'none').price * regionInfo().labor;
}

/* 把当前地区/材料/网价写入一行。force=true 时覆盖用户已填的费率。 */
function applyRatesToRow(r, force) {
  if (!r) return;
  var cat = r.cat;
  var list = materialList(cat);
  if (list.length) {
    if (!r.matKey || !materialInfo(cat, r.matKey)) r.matKey = list[0].key;
    var m = materialInfo(cat, r.matKey);
    if (force || !r.p.density) r.p.density = m.density;
    if (cat === 'profile' && (force || !r.p.weightPerM))
      r.p.weightPerM = m.weightPerM || 0;
    if (force) r.p.matPrice = materialPrice(cat, r.matKey);
    else if (!r.p.matPrice) r.p.matPrice = materialPrice(cat, r.matKey);
  }
  if (!force) return;

  if (cat === 'plastic') r.p.machineRate = processRate('plasticMachine');
  if (cat === 'diecast') {
    if (!r.p.castingMethod) r.p.castingMethod = 'diecast';
    var cm = castingMethodInfo(r.p.castingMethod);
    r.p.castingMethod = cm.key;
    r.p.machineRate = processRate(cm.rateKey);
    if (force || !r.p.cycleSec) r.p.cycleSec = cm.cycleSec;
    if (force || !r.p.deburrCost) r.p.deburrCost = cm.deburr;
  }
  if (cat === 'cnc') r.p.machineRate = processRate('cncMachine');
  if (cat === 'print3d') r.p.machineRate = processRate('printMachine');
  if (cat === 'sheet') {
    r.p.laserCost = processRate('laser');
    r.p.bendCost = processRate('bend');
  }
  if (cat === 'profile') {
    r.p.cutCost = processRate('profileCut');
    r.p.machineCost = processRate('profileMachine');
  }
  if (SURFACE_CATS[cat]) {
    if (!r.surfaceKey) r.surfaceKey = 'none';
    r.p.surfaceCost = surfacePrice(r.surfaceKey);
  }
}

/* 材料下拉 HTML */
function materialOptionsHtml(cat, selected) {
  var list = materialList(cat);
  return list.map(function (m) {
    return '<option value="' + m.key + '"' + (m.key === selected ? ' selected' : '') +
      '>' + m.name + '</option>';
  }).join('');
}

function surfaceOptionsHtml(selected) {
  return SURFACES.map(function (s) {
    return '<option value="' + s.key + '"' + (s.key === selected ? ' selected' : '') +
      '>' + s.name + '</option>';
  }).join('');
}
