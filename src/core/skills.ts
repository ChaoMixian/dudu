import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, normalize, resolve, sep } from 'node:path';
import { loadSkillsFromDir } from '@earendil-works/pi-coding-agent';

export interface SkillSummary {
  slug: string;
  name: string;
  description: string;
  path: string;
  source?: string;
  skillId?: string;
  installedAt?: string;
  fileCount?: number;
}

export interface RemoteSkill {
  id: string;
  name: string;
  description: string;
  folder: string;
  source: string;
  files: number;
}

export interface SearchResult {
  id: string;
  name: string;
  source: string;
  skillId: string;
  installs: number;
}

interface GitHubSource { owner: string; repo: string; ref?: string; subpath?: string }
interface SkillMeta { source?: string; skillId?: string; folder?: string; installedAt?: string; fileCount?: number }
type MetaMap = Record<string, SkillMeta>;

const MAX_SKILL_FILES = 200;
const MAX_SKILL_BYTES = 5 * 1024 * 1024;
const MAX_INSPECT_SKILLS = 80;

function safeSlug(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-._]+|[-._]+$/g, '').slice(0, 64);
  if (!slug || slug === '.' || slug === '..') throw new Error('Invalid skill name');
  return slug;
}

function parseFrontmatter(text: string): { name?: string; description?: string } {
  if (!text.startsWith('---')) return {};
  const end = text.indexOf('\n---', 3);
  if (end < 0) return {};
  const lines = text.slice(3, end).split(/\r?\n/);
  const values: Record<string, string> = {};
  let current = '';
  for (const line of lines) {
    const match = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(line);
    if (match) {
      current = match[1]!;
      values[current] = (match[2] ?? '').trim();
      continue;
    }
    if (current && /^\s+/.test(line)) values[current] = `${values[current] ?? ''} ${line.trim()}`.trim();
  }
  const clean = (value?: string) => value?.replace(/^['"]|['"]$/g, '').trim() || undefined;
  return { name: clean(values.name), description: clean(values.description) };
}

function parseGithubSource(input: string): GitHubSource {
  const raw = input.trim();
  if (!raw) throw new Error('Repository is required');
  const skillsSh = /^https?:\/\/skills\.sh\/([^/]+)\/([^/]+)\/([^/?#]+)/.exec(raw);
  if (skillsSh) return { owner: skillsSh[1]!, repo: skillsSh[2]!, subpath: skillsSh[3]! };
  const url = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)(?:\/tree\/([^/]+)(?:\/(.*))?)?/.exec(raw);
  if (url) return { owner: url[1]!, repo: url[2]!.replace(/\.git$/, ''), ...(url[3] ? { ref: url[3] } : {}), ...(url[4] ? { subpath: url[4] } : {}) };
  const short = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:@([^/]+))?$/.exec(raw);
  if (short) return { owner: short[1]!, repo: short[2]!, ...(short[3] ? { ref: short[3] } : {}) };
  throw new Error('Use owner/repo, a GitHub URL, or a skills.sh skill URL');
}

async function githubJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'user-agent': 'dudu' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(url, { headers, signal });
  if (response.status === 403 || response.status === 429) throw new Error('GitHub rate limit reached. Set GITHUB_TOKEN or try again later.');
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return await response.json() as T;
}

async function rawFile(owner: string, repo: string, ref: string, path: string, signal?: AbortSignal): Promise<string> {
  const encodedRef = ref.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${encodedRef}/${path.split('/').map(encodeURIComponent).join('/')}`, { signal });
  if (!response.ok) throw new Error(`Failed to download ${path}: HTTP ${response.status}`);
  return await response.text();
}

export class SkillStore {
  readonly root: string;
  private readonly metaPath: string;
  private popularCache?: { at: number; skills: SearchResult[] };
  private descriptionCache = new Map<string, { at: number; text: string }>();
  constructor(readonly workspace: string) {
    this.root = join(workspace, 'skills');
    this.metaPath = join(workspace, '.dudu', 'skills.json');
    mkdirSync(this.root, { recursive: true });
  }

  private meta(): MetaMap {
    try { return JSON.parse(readFileSync(this.metaPath, 'utf8')) as MetaMap; } catch { return {}; }
  }

  private saveMeta(value: MetaMap) {
    mkdirSync(dirname(this.metaPath), { recursive: true });
    const tmp = `${this.metaPath}.${crypto.randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    renameSync(tmp, this.metaPath);
  }

  list(): SkillSummary[] {
    const meta = this.meta();
    const loaded = loadSkillsFromDir({ dir: this.root, source: 'workspace' });
    return loaded.skills.map(skill => {
      const slug = basename(skill.baseDir);
      const info = meta[slug];
      let files = 0;
      try { files = readdirSync(skill.baseDir, { recursive: true }).length; } catch { /* best effort */ }
      return { slug, name: skill.name, description: skill.description, path: skill.filePath, ...(info?.source ? { source: info.source } : {}), ...(info?.skillId ? { skillId: info.skillId } : {}), ...(info?.installedAt ? { installedAt: info.installedAt } : {}), fileCount: files };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  remove(slugInput: string): void {
    const slug = safeSlug(slugInput);
    const target = join(this.root, slug);
    if (!existsSync(target)) throw new Error('Skill not found');
    if (!this.contained(target)) throw new Error('Invalid skill path');
    rmSync(target, { recursive: true, force: true });
    const meta = this.meta();
    delete meta[slug];
    this.saveMeta(meta);
  }

  async search(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
    const q = query.trim();
    if (q.length < 2) throw new Error('Search needs at least 2 characters');
    const response = await fetch(`https://skills.sh/api/search?q=${encodeURIComponent(q)}`, { headers: { accept: 'application/json' }, signal });
    if (!response.ok) throw new Error(`skills.sh returned HTTP ${response.status}`);
    const payload = await response.json() as { skills?: any[] };
    return (Array.isArray(payload.skills) ? payload.skills : []).slice(0, 50).map(item => ({
      id: String(item.id ?? ''),
      name: String(item.name ?? item.skillId ?? ''),
      source: String(item.source ?? ''),
      skillId: String(item.skillId ?? ''),
      installs: Number(item.installs ?? 0),
    })).filter(skill => /^[^/]+\/[^/]+$/.test(skill.source));
  }

  /** The public search API needs a query; merge several broad queries to approximate the install leaderboard. */
  async popular(signal?: AbortSignal): Promise<SearchResult[]> {
    if (this.popularCache && Date.now() - this.popularCache.at < 5 * 60_000) return this.popularCache.skills;
    const lists = await Promise.all(['skills', 'agent', 'ai', 'design', 'code'].map(query => this.search(query, signal).catch(() => [] as SearchResult[])));
    const byId = new Map<string, SearchResult>();
    for (const list of lists) for (const skill of list) if (!byId.has(skill.id)) byId.set(skill.id, skill);
    const skills = [...byId.values()].sort((a, b) => b.installs - a.installs).slice(0, 120);
    if (!skills.length) throw new Error('skills.sh returned no popular skills');
    this.popularCache = { at: Date.now(), skills };
    return skills;
  }

  /** Skills.sh search omits descriptions; read the public skill page metadata for the visible cards. */
  async describe(ids: string[], signal?: AbortSignal): Promise<Record<string, string>> {
    const wanted = [...new Set(ids.filter(value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/.test(value) && !value.includes('..')))].slice(0, 60);
    const result: Record<string, string> = {};
    const pending: string[] = [];
    for (const value of wanted) {
      const cached = this.descriptionCache.get(value);
      if (cached && Date.now() - cached.at < 10 * 60_000) result[value] = cached.text;
      else pending.push(value);
    }
    let cursor = 0;
    const worker = async () => {
      while (cursor < pending.length) {
        const value = pending[cursor++]!;
        let text = '';
        try {
          const response = await fetch(`https://skills.sh/${value}`, { headers: { accept: 'text/html' }, signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(8_000)]) });
          if (response.ok) {
            const html = await response.text();
            const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
            for (const tag of tags) {
              if (!/(?:name|property)=["'](?:description|og:description)["']/i.test(tag)) continue;
              const content = /content=["']([^"']*)["']/i.exec(tag)?.[1];
              if (content) { text = content; break; }
            }
          }
        } catch { /* description is optional */ }
        text = text.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&hellip;/g, '…').slice(0, 500);
        this.descriptionCache.set(value, { at: Date.now(), text });
        result[value] = text;
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    return result;
  }

  async inspect(input: string, signal?: AbortSignal): Promise<{ source: string; ref: string; skills: RemoteSkill[] }> {
    const parsed = parseGithubSource(input);
    const repo = await githubJson<{ default_branch?: string }>(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, signal);
    const ref = parsed.ref ?? repo.default_branch ?? 'main';
    const tree = await githubJson<{ tree?: Array<{ path: string; type: string; mode?: string; size?: number }>; truncated?: boolean }>(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, signal);
    if (tree.truncated) throw new Error('Repository tree is too large to inspect');
    const files = tree.tree ?? [];
    const skillFiles = files.filter(file => file.type === 'blob' && /(^|\/)SKILL\.md$/.test(file.path) && (!parsed.subpath || file.path.startsWith(`${parsed.subpath}/`) || dirname(file.path) === parsed.subpath));
    const skills: RemoteSkill[] = [];
    for (const file of skillFiles.slice(0, MAX_INSPECT_SKILLS)) {
      const folder = dirname(file.path) === '.' ? '' : dirname(file.path);
      const raw = await rawFile(parsed.owner, parsed.repo, ref, file.path, signal);
      const front = parseFrontmatter(raw);
      const fallback = folder ? basename(folder) : parsed.repo;
      skills.push({
        id: folder || parsed.repo,
        name: front.name ?? fallback,
        description: front.description ?? '',
        folder,
        source: `${parsed.owner}/${parsed.repo}`,
        files: files.filter(item => item.type === 'blob' && folder && item.path.startsWith(`${folder}/`)).length,
      });
    }
    return { source: `${parsed.owner}/${parsed.repo}`, ref, skills };
  }

  async install(input: string, skillId?: string, signal?: AbortSignal): Promise<SkillSummary> {
    const inspected = await this.inspect(input, signal);
    const wanted = skillId?.trim();
    const matches = wanted
      ? inspected.skills.filter(skill => skill.id === wanted || skill.folder === wanted || skill.name === wanted || basename(skill.folder) === wanted)
      : inspected.skills;
    if (!matches.length) throw new Error(`Skill not found in ${inspected.source}`);
    if (matches.length > 1) throw new Error(`Several skills match; choose one of: ${matches.map(skill => skill.id || skill.name).join(', ')}`);
    const skill = matches[0]!;
    const parsed = parseGithubSource(input);
    const folder = skill.folder;
    const tree = await githubJson<{ tree?: Array<{ path: string; type: string; mode?: string; size?: number }> }>(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/trees/${encodeURIComponent(inspected.ref)}?recursive=1`, signal);
    const files = (tree.tree ?? []).filter(file => file.type === 'blob' && (folder ? file.path.startsWith(`${folder}/`) : true));
    if (!files.length) throw new Error('Skill folder is empty');
    if (files.length > MAX_SKILL_FILES) throw new Error(`Skill has too many files (${files.length} > ${MAX_SKILL_FILES})`);
    if (files.some(file => file.mode === '120000')) throw new Error('Skill contains a symlink; refusing to install');
    const total = files.reduce((sum, file) => sum + (file.size ?? 0), 0);
    if (total > MAX_SKILL_BYTES) throw new Error(`Skill is too large (${Math.round(total / 1024)} KiB)`);
    const slug = safeSlug(basename(folder) || skill.name);
    const target = join(this.root, slug);
    if (existsSync(target)) throw new Error(`Skill "${slug}" is already installed; remove it first`);
    const tmp = join(this.root, `.${slug}.${crypto.randomUUID()}.tmp`);
    mkdirSync(tmp, { recursive: true });
    try {
      for (const file of files) {
        const relative = folder ? file.path.slice(folder.length + 1) : file.path;
        if (!relative || relative.split('/').includes('..') || relative.includes('\0')) throw new Error(`Unsafe skill path: ${file.path}`);
        const destination = resolve(tmp, relative);
        if (!destination.startsWith(`${resolve(tmp)}${sep}`)) throw new Error(`Unsafe skill path: ${file.path}`);
        mkdirSync(dirname(destination), { recursive: true });
        const content = await rawFile(parsed.owner, parsed.repo, inspected.ref, file.path, signal);
        writeFileSync(destination, content, { mode: 0o644 });
      }
      const skillFile = join(tmp, 'SKILL.md');
      if (!existsSync(skillFile)) throw new Error('Skill is missing SKILL.md');
      const front = parseFrontmatter(readFileSync(skillFile, 'utf8'));
      if (!front.name || !front.description) throw new Error('SKILL.md needs a name and description in frontmatter');
      renameSync(tmp, target);
    } catch (error) {
      rmSync(tmp, { recursive: true, force: true });
      throw error;
    }
    const meta = this.meta();
    meta[slug] = { source: inspected.source, skillId: skill.id, folder, installedAt: new Date().toISOString(), fileCount: files.length };
    this.saveMeta(meta);
    const summary = this.list().find(item => item.slug === slug);
    if (!summary) throw new Error('Skill installed but could not be loaded');
    return summary;
  }

  private contained(path: string): boolean {
    const root = resolve(this.root) + sep;
    return normalize(resolve(path)).startsWith(root);
  }
}
