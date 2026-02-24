const fs = require('fs');
const path = require('path');

const toolsDir = path.join(process.cwd(), 'tools');
if (!fs.existsSync(toolsDir)) {
    console.error("Directory tools/ not found.");
    process.exit(1);
}

const files = fs.readdirSync(toolsDir).filter(f => f.endsWith('.cjs') || f.endsWith('.ts'));

files.forEach(file => {
    const src = path.join(toolsDir, file);
    let content = fs.readFileSync(src, 'utf8');

    // Remove auto-discovery function and calls
    content = content.replace(/function tryExtractServiceRoleKeyFromRepo\(\) \{[\s\S]*?\}/g, '');
    content = content.replace(/const extracted = tryExtractServiceRoleKeyFromRepo\(\);/g, '');
    content = content.replace(/if \(extracted && \(!supabaseKey || !String\(supabaseKey\).startsWith\('sb_secret_'\)\)\) \{[\s\S]*?\}/g, '');

    fs.writeFileSync(src, content);
    console.log(`Hardened: ${file}`);
});
