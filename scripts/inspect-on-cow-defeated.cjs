const fs = require('fs');
const h = fs.readFileSync('web/public/trading-room.html', 'utf8');

const i = h.indexOf('if(intent.rangerAutomation){const current=sel');
console.log(h.slice(i, i+1500));
