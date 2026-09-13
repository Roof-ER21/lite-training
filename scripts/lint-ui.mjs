import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
const root = process.cwd();
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
for (const file of ['index.css', 'training-ui.css', 'learning-workspace.css', 'inspection-roleplay.css']) {
  const css = postcss.parse(fs.readFileSync(path.join(root,file),'utf8'));
  css.walkDecls(decl => {
    check(!/#[a-f\d]{3,8}\b|rgba?\(/i.test(decl.value), `${file}: ${decl.prop} must use a theme token`);
    check(!/gradient\(/i.test(decl.value), `${file}: decorative gradients are not part of the training UI`);
    check(!(decl.prop === 'transition' && /\ball\b/.test(decl.value)), `${file}: specify the transition properties`);
  });
  css.walkRules(rule => check(!/data-theme/.test(rule.selector), `${file}: put theme values in theme.css`));
}
const source = fs.readFileSync('index.tsx','utf8');
check(!/\p{Extended_Pictographic}/u.test(source), 'index.tsx: remove decorative emoji');
check(!/canvas-confetti|renderLeaderboardSection|renderBadgesSection|triggerConfetti/.test(source), 'Arcade renderers must not return');
check(!/>\s*(?:Total XP|Day Streak|Time Trained|Next Milestone|Leaderboard)\s*</.test(source), 'Arcade display labels must not return');
check(!/progressPct\s*\+\s*'%'.*textContent|completionRate\}%/.test(source), 'Completion displays must use state words');
const html = fs.readFileSync('dist/index.html','utf8');
check(/<title>[^<]+<\/title>/.test(html), 'Built page needs a title');
check(!/lorem ipsum|\[object Object\]/i.test(html), 'Built shell contains placeholder text');
for (const [,url] of html.matchAll(/(?:src|href)="(\/[^"?#]+)"/g)) {
  check(fs.existsSync(path.join(root,'dist',url)), `Missing built asset: ${url}`);
}
check(fs.existsSync('dist/theme-init.js'), 'Theme bootstrap must ship with the shell');
if (failures.length) { console.error([...new Set(failures)].join('\n')); process.exit(1); }
console.log('UI gate passed: shared tokens, no gradients/emoji/arcade renderers, built shell assets resolve.');
