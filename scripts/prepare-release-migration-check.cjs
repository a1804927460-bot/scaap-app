const fs = require('node:fs');
const path = require('node:path');
const { quoteMediaCredits } = require('../lib/credit-pricing');
const apply = process.argv.includes('--apply');

// Generate a rollback-only preflight; never repair or replay the old baseline.
const versions = [
  '202608280001', '202608280002', '202608280003', '202608280004', '202608280005', '202608280006',
  '202609030001', '202609040001', '202609040002', '202609050001',
  '202609050003', '202609060001', '202609060002', '202609060003'
];
const dir = path.resolve('supabase/migrations');
const files = fs.readdirSync(dir);
const parts = ["begin;\nset local lock_timeout = '2s';\nset local statement_timeout = '20s';"];
for (const version of versions) {
  const matches = files.filter(file => file.startsWith(`${version}_`));
  if (matches.length !== 1) throw new Error(`Ambiguous migration ${version}`);
  const sql = fs.readFileSync(path.join(dir, matches[0]), 'utf8');
  // These reviewed migrations use standalone top-level transaction delimiters.
  parts.push(`-- ${matches[0]}\n` + sql.replace(/^(?:begin|commit);\s*$/gmi, ''));
  if (apply) {
    const literal = value => "'" + value.replaceAll("'", "''") + "'";
    parts.push(`insert into supabase_migrations.schema_migrations(version,name,statements) values (${literal(version)},${literal(matches[0].slice(version.length + 1, -4))},ARRAY[${literal(sql)}]) on conflict(version) do nothing;`);
  }
}
for (const providerId of ['image-1', 'image-2', 'image-6']) {
  for (const size of ['1K', '2K', '4K']) {
    for (const quality of providerId === 'image-6' ? ['low', 'medium', 'high'] : ['medium']) {
      const quote = quoteMediaCredits({ kind: 'image', providerId, size, quality });
      const resolution = providerId === 'image-6' ? `${quality}:${size}` : size;
      parts.push(`do $$ begin if public.quote_ai_image_unit_credits('${providerId}','${resolution}') <> ${quote.totalCredits} then raise exception 'image quote parity failed: ${providerId}/${resolution}'; end if; end $$;`);
    }
  }
}
parts.push(apply ? 'commit;\n' : "select 'release migration preflight passed; rolling back' as result;\nrollback;\n");
fs.mkdirSync('test-artifacts/release', { recursive: true });
fs.writeFileSync(`test-artifacts/release/migration-${apply ? 'apply' : 'preflight'}.sql`, parts.join('\n'));
console.log(`Generated ${apply ? 'transactional rollout' : 'rollback-only preflight'} for ${versions.length} migrations, with image quote parity assertions.`);
