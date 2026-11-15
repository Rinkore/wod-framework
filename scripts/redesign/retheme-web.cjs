// 一次性:把前端硬编码文案替换为雨蚀荒原世界观。可删。
const fs = require("fs");
const path = require("path");

const DICT = [
  ["余烬边境", "雨蚀荒原"],
  ["边境档案", "荒原记录"],
  ["边境议会", "拾荒行会"],
  ["议会", "行会"],
  ["灰烬纪元", "雨季纪"],
  ["灰烬", "燃烬"],
  ["边境", "荒原"],
  ["冒险者", "拾荒者"],
  ["火把", "雨灯"],
  ["火把点起之前", "雨停之前"],
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(tsx?|html)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = [
  ...walk("apps/web/src"),
  "apps/web/index.html",
];
for (const file of files) {
  let text = fs.readFileSync(file, "utf8");
  const original = text;
  for (const [from, to] of DICT) text = text.split(from).join(to);
  if (text !== original) fs.writeFileSync(file, text);
}
console.log(`rethemed ${files.length} web files`);
