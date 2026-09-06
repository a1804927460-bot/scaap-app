const fs = require('node:fs');
const path = require('node:path');
const versions = ['202609050001', '202609060002'];
const files = fs.readdirSync('supabase/migrations');
const parts = ["begin;\nset local lock_timeout = '2s';\nset local statement_timeout = '20s';"];
for (const version of versions) {
  const matches = files.filter(file => file.startsWith(`${version}_`));
  if (matches.length !== 1) throw new Error(`Ambiguous migration ${version}`);
  const file = matches[0];
  const sql = fs.readFileSync(path.join('supabase/migrations', file), 'utf8');
  parts.push(sql.replace(/^(?:begin|commit);\s*$/gmi, ''));
  const literal = value => "'" + value.replaceAll("'", "''") + "'";
  parts.push(`insert into supabase_migrations.schema_migrations(version, name, statements) values (${literal(version)}, ${literal(file.slice(version.length + 1, -4))}, ARRAY[${literal(sql)}]) on conflict (version) do nothing;`);
}
parts.push("notify pgrst, 'reload schema';\ncommit;\n");
fs.mkdirSync('test-artifacts/release', { recursive: true });
fs.writeFileSync('test-artifacts/release/video-storage-apply.sql', parts.join('\n'));
console.log('Generated atomic video storage migration, with matching history records.');
