const fs = require('fs');

const files = [
  'web/public/trading-room.html',
  'web/public/pasture-brain-refine.css',
  'web/public/pasture-ui-refine.css',
  'web/dist/trading-room.html',
  'web/dist/pasture-brain-refine.css'
];

for (const f of files) {
  if (!fs.existsSync(f)) continue;
  const content = fs.readFileSync(f, 'utf8');
  const matches = content.match(/[^{}]*ranger-brain-tabs[^{}]*\{[^}]*\}/g) || [];
  const iconMatches = content.match(/[^{}]*brain-tab-icon[^{}]*\{[^}]*\}/g) || [];
  console.log(`=== ${f} ===`);
  matches.forEach(m => console.log('TAB RULE:', m.trim().replace(/\s+/g, ' ')));
  iconMatches.forEach(m => console.log('ICON RULE:', m.trim().replace(/\s+/g, ' ')));
}
