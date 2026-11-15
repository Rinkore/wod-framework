// 一次性补丁:views/presets 改用 classSkillIds。可删。
const fs = require("fs");
let views = fs.readFileSync("apps/server/src/views.ts", "utf8");
views = views.replace(
  "const skills: HeroSkillView[] = cls.skillIds.flatMap((id) => {",
  "const skills: HeroSkillView[] = classSkillIds(cls, content).flatMap((id) => {",
);
views = views.replace(
  "import {\n  clamp,\n  skillPhases,",
  "import {\n  clamp,\n  classSkillIds,\n  skillPhases,",
);
fs.writeFileSync("apps/server/src/views.ts", views);

let presets = fs.readFileSync("apps/server/src/services/presets.ts", "utf8");
presets = presets.replace(
  "import {\n  MAX_HERO_PRESETS,",
  "import {\n  MAX_HERO_PRESETS,\n  classSkillIds,",
);
presets = presets.replace(
  "const skillIds = new Set(cls.skillIds);",
  "const skillIds = new Set(classSkillIds(cls, content));",
);
fs.writeFileSync("apps/server/src/services/presets.ts", presets);
console.log("patched");
