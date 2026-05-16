const fs = require('fs');
const path = require('path');

function cleanString(s) {
  return String(s || '').trim();
}

function cleanVideoLine(line) {
  return String(line || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t ]+/g, ' ')
    .trim();
}

function isScrapeNoiseLine(line) {
  if (!line) return true;
  // Pure duration/index fragments, e.g. 8900:0001:15:44, 8500:00, 01:15:44.
  if (!/[A-Za-z]/.test(line)) return true;
  // Dates copied from the page, e.g. 13-Mar-2026 12:04.
  if (/^\d{1,2}-[A-Za-z]{3}-\d{4}(\s+\d{1,2}:\d{2})?$/.test(line)) return true;
  // Generic web UI labels
  if (/^(share|download|watch now|live|view|views)$/i.test(line)) return true;
  return false;
}

function pad2(n) {
  n = String(Number(n));
  return n.length < 2 ? '0' + n : n;
}

function pad3(n) {
  n = String(Number(n));
  while (n.length < 3) n = '0' + n;
  return n;
}

function normalizeTopicTitle(title) {
  title = cleanString(title)
    .replace(/\s*\|\s*/g, ' | ')
    .replace(/\s*\|\s*\|\s*/g, ' || ')
    .replace(/Class-\s+/i, 'Class-')
    .replace(/Class\s*-?\s*(\d+)/i, function (_, n) { return 'Class-' + pad2(n); })
    .trim();
  return title;
}

function titleCase(s) {
  s = cleanString(s).toLowerCase();
  if (!s) return 'General';
  return s.replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); });
}

function extractSubsection(title, category) {
  var parts = title.split('|').map(function (p) { return cleanString(p); }).filter(Boolean);
  if (parts.length >= 3) return titleCase(parts[parts.length - 1]);
  if (parts.length === 2 && /^Class/i.test(parts[0])) return titleCase(parts[1]);
  return 'General';
}

function extractClassNumber(title) {
  var m = String(title || '').match(/Class\s*-\s*(\d+)/i);
  return m ? Number(m[1]) : '';
}

function categoryFromSourceFile(sourceFile) {
  var s = String(sourceFile || '').toLowerCase();
  if (s.indexOf('basic concept') !== -1) return 'Maths Basic Concepts';
  if (s.indexOf('calculation capsule') !== -1) return 'Maths Calculation Capsule';
  if (s.indexOf('maths arithmetic') !== -1) return 'Maths Arithmetic';
  if (s.indexOf('maths advance') !== -1) return 'Maths Advance';
  if (s.indexOf('reasoning') !== -1) return 'Reasoning';
  if (s.indexOf('english') !== -1) return 'English';
  if (s.indexOf('history') !== -1) return 'History';
  if (s.indexOf('geography') !== -1) return 'Geography';
  if (s.indexOf('polity') !== -1) return 'Polity';
  if (s.indexOf('economy') !== -1) return 'Economy';
  if (s.indexOf('physics') !== -1) return 'Physics';
  if (s.indexOf('chemistry') !== -1) return 'Chemistry';
  if (s.indexOf('computer') !== -1) return 'Computer';
  if (s.indexOf('static') !== -1 && s.indexOf('gk') !== -1) return 'Static GK';
  if (s.indexOf('biology') !== -1) return 'Biology';
  return titleCase(sourceFile.replace(/\.txt$/i, ''));
}

function defaultPriorityForCategory(category) {
  return /^(Maths|Reasoning|English)/i.test(category) ? 'high' : 'medium';
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'topic';
}

function makeTopicId(category, order, topicName) {
  var base = slugify(category) + '-' + pad3(order) + '-' + slugify(topicName).slice(0, 80);
  return base.replace(/-+$/g, '');
}

function dedupeAdjacent(arr) {
  var out = [];
  var last = '';
  for (var i = 0; i < arr.length; i++) {
    var current = cleanString(arr[i]);
    if (!current) continue;
    if (current === last) continue;
    out.push(current);
    last = current;
  }
  return out;
}

function parseRawCareerwillFile(sourceFile, rawText) {
  var category = categoryFromSourceFile(sourceFile);
  var priority = defaultPriorityForCategory(category);
  var rawLines = rawText.split(/\r?\n/);
  var titles = [];

  for (var i = 0; i < rawLines.length; i++) {
    var line = cleanVideoLine(rawLines[i]);
    if (!line) continue;
    if (isScrapeNoiseLine(line)) continue;
    titles.push(line);
  }

  titles = dedupeAdjacent(titles);
  titles.reverse(); 
  titles = dedupeAdjacent(titles);

  var out = [];
  for (var j = 0; j < titles.length; j++) {
    var topicName = normalizeTopicTitle(titles[j]);
    if (!topicName) continue;

    var subsection = extractSubsection(topicName, category);
    var classNo = extractClassNumber(topicName);
    var courseOrder = out.length + 1;
    var topicId = makeTopicId(category, courseOrder, topicName);

    out.push({
      topicId: topicId,
      category: category,
      subsection: subsection,
      topicName: topicName,
      priority: priority,
      courseOrder: courseOrder,
      classNo: classNo,
      sourceFile: sourceFile
    });
  }

  return out;
}

function dedupeTopicIds(topics) {
  var seen = {};
  for (var i = 0; i < topics.length; i++) {
    var id = topics[i].topicId;
    if (!seen[id]) {
      seen[id] = 1;
    } else {
      seen[id]++;
      topics[i].topicId = id + '-' + seen[id];
    }
  }
  return topics;
}

function main() {
  const rawDir = path.join(__dirname, '../data/raw');
  const outFile = path.join(__dirname, '../data/topics.json');

  if (!fs.existsSync(rawDir)) {
    console.error('Raw directory not found:', rawDir);
    process.exit(1);
  }

  const files = fs.readdirSync(rawDir).filter(f => f.endsWith('.txt'));
  let allTopics = [];

  files.forEach(file => {
    const rawText = fs.readFileSync(path.join(rawDir, file), 'utf8');
    const parsed = parseRawCareerwillFile(file, rawText);
    allTopics = allTopics.concat(parsed);
    console.log(`Parsed ${parsed.length} topics from ${file}`);
  });

  allTopics = dedupeTopicIds(allTopics);
  fs.writeFileSync(outFile, JSON.stringify(allTopics, null, 2));
  console.log(`Successfully wrote ${allTopics.length} total topics to ${outFile}`);
}

main();
