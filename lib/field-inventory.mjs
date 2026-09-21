const definitions = {
  KCDM: ["课程代码", "课程"],
  KCMC: ["课程名称", "课程"],
  KCMCYW: ["课程英文名称", "课程"],
  KCXZDM: ["课程性质代码", "课程"],
  KCFLDM: ["课程分类代码", "课程"],
  BJDM: ["班级代码", "班级"],
  BJMC: ["班级名称", "班级"],
  JXERM: ["教学任务标识", "课程"],
  KKDW: ["开课单位代码", "课程"],
  KKDW_DISPLAY: ["开课单位", "课程"],
  YXYWMC: ["院系/业务名称", "课程"],
  RKJS: ["任课教师", "授课"],
  SKFSDM: ["授课方式代码", "授课"],
  SKFSDM_DISPLAY: ["授课方式", "授课"],
  XDFSDM: ["选课方式代码", "选课"],
  XSJXFSDM: ["学习/教学方式代码", "选课"],
  XSJXFSDM_DISPLAY: ["学习/教学方式", "选课"],
  XQDM: ["校区代码", "时间地点"],
  XQDM_DISPLAY: ["校区显示", "时间地点"],
  PKSJ: ["排课时间原始字段", "时间地点"],
  KSSJMS: ["开始时间描述", "时间地点"],
  SKXS: ["授课形式代码", "授课"],
  SKXS_DISPLAY: ["授课形式", "授课"],
  PKDD: ["排课地点", "时间地点"],
  PKSJDD: ["排课时间地点组合显示", "时间地点"],
  KSDDMS: ["上课地点描述", "时间地点"],
  SCSKRQ: ["上课日期字段", "时间地点"],
  XKBZ: ["选课/排课备注", "备注"],
  KBBZ: ["课表备注", "备注"],
  XSJXFSBZ: ["教学方式备注", "备注"],
  XNXQDM: ["学年学期代码", "学期"],
  XNXQDM_DISPLAY: ["学年学期显示", "学期"],
  XNXQYWMC: ["学年学期名称", "学期"],
  XF: ["学分", "工作量"],
  ZXS: ["总学时", "工作量"],
  XKRS: ["选课人数", "工作量"],
  YAPXS: ["已安排学时", "工作量"],
  XH: ["学号", "身份"],
  WID: ["记录标识", "系统元数据"],
  ORDERFILTER: ["排序/过滤元数据", "系统元数据"],
  DZ_SCU_EWMFJ: ["二维码附件字段", "扩展"],
};

function definitionFor(name) {
  if (definitions[name]) {
    const [label, group] = definitions[name];
    return { label, group };
  }
  if (/^BY\d+$/.test(name)) return { label: "备用字段", group: "扩展" };
  if (name.endsWith("_DISPLAY")) return { label: "显示字段", group: "扩展" };
  return { label: null, group: "未分类" };
}

function isEmpty(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

function inferType(values) {
  if (!values.length) return "empty";
  if (values.every((value) => typeof value === "number")) return "number";
  if (values.every((value) => typeof value === "boolean")) return "boolean";
  return "string";
}

function safeSample(value) {
  if (typeof value === "string" && value.length > 160) return `${value.slice(0, 157)}...`;
  return value;
}

export function fieldInventory(rows, { includeSamples = true } = {}) {
  const names = [];
  const seen = new Set();
  for (const row of rows) {
    for (const name of Object.keys(row)) {
      if (!seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  }

  return names.map((name) => {
    const values = rows.map((row) => row[name]).filter((value) => !isEmpty(value));
    const definition = definitionFor(name);
    const result = {
      name,
      label: definition.label,
      group: definition.group,
      type: inferType(values),
      presentCount: values.length,
      rowCount: rows.length,
    };
    if (includeSamples) {
      result.samples = [...new Set(values.map(safeSample))].slice(0, 3);
    }
    return result;
  });
}
