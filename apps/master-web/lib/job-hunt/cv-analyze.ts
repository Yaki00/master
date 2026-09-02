export type CvAnalysisResult = {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  stack: string[];
  languages: string[];
  targetRoles: string[];
  cvMarkdown: string;
  summary: string;
};

const KNOWN_SKILLS = [
  "javascript", "typescript", "python", "java", "kotlin", "swift", "go", "golang", "rust", "c#", "c++",
  "php", "ruby", "scala", "elixir", "dart", "flutter", "react", "react native", "vue", "vue.js", "angular",
  "svelte", "next.js", "nextjs", "nuxt", "remix", "node", "node.js", "express", "nestjs", "fastapi",
  "django", "flask", "spring", "laravel", "symfony", ".net", "asp.net", "graphql", "rest", "grpc",
  "postgresql", "postgres", "mysql", "mongodb", "redis", "sqlite", "elasticsearch", "kafka", "rabbitmq",
  "docker", "kubernetes", "k8s", "terraform", "ansible", "aws", "gcp", "azure", "cloudflare",
  "ci/cd", "github actions", "gitlab ci", "jenkins", "linux", "bash", "git", "tailwind", "css", "sass",
  "html", "webpack", "vite", "esbuild", "jest", "vitest", "cypress", "playwright", "pytest",
  "machine learning", "deep learning", "pytorch", "tensorflow", "llm", "openai", "langchain",
  "figma", "sql", "nosql", "microservices", "devops", "sre", "agile", "scrum", "tdd",
  "react.js", "vue3", "rxjs", "redux", "zustand", "prisma", "supabase", "firebase",
  "electron", "tauri", "ios", "android", "mobile", "full stack", "fullstack", "backend", "frontend",
];

const ROLE_PATTERNS = [
  /(?:développeur|developpeur|developer|engineer|ingénieur|ingenieur|architect|devops|sre|lead|staff|principal|full[- ]?stack|frontend|front-end|backend|back-end|mobile|data engineer|software)[\w\s/-]*/gi,
  /(?:senior|junior|mid)[\s-]+(?:developer|engineer|dev|développeur)[\w\s/-]*/gi,
];

const LANGUAGE_HINTS: Record<string, string> = {
  français: "français",
  francais: "français",
  french: "français",
  anglais: "anglais",
  english: "anglais",
  espagnol: "espagnol",
  spanish: "espagnol",
  allemand: "allemand",
  german: "allemand",
  italien: "italien",
  italian: "italien",
  portugais: "portugais",
  portuguese: "portugais",
};

function normalizeSkill(raw: string): string {
  const s = raw.trim().toLowerCase();
  const aliases: Record<string, string> = {
    "node.js": "node",
    "react.js": "react",
    "vue.js": "vue",
    "next.js": "nextjs",
    golang: "go",
    "full stack": "fullstack",
    "full-stack": "fullstack",
    postgresql: "postgres",
    kubernetes: "k8s",
  };
  return aliases[s] ?? s;
}

function uniqueSorted(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function extractSkills(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];

  for (const skill of KNOWN_SKILLS) {
    const pattern = skill.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?:^|[\\s,;/|•·-])${pattern}(?:[\\s,;/|•·.-]|$)`, "i").test(lower)) {
      found.push(normalizeSkill(skill));
    }
  }

  const skillsSection = text.match(
    /(?:compétences|competences|skills|technologies|stack|expertise)[:\s]*([\s\S]{0,800}?)(?:\n\n|\n[A-Z#]|$)/i,
  );
  if (skillsSection?.[1]) {
    const tokens = skillsSection[1]
      .split(/[,;|•·/\n]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 1 && t.length < 40);
    for (const token of tokens) {
      const norm = normalizeSkill(token);
      if (norm.length > 1) found.push(norm);
    }
  }

  return uniqueSorted(found);
}

function extractLanguages(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const [hint, label] of Object.entries(LANGUAGE_HINTS)) {
    if (lower.includes(hint)) found.push(label);
  }
  return uniqueSorted(found);
}

function cleanRole(raw: string): string {
  return raw.replace(/\s+/g, " ").replace(/[|•·,;]+$/, "").trim().slice(0, 80);
}

function extractTargetRoles(text: string): string[] {
  const roles: string[] = [];

  const searchRe =
    /(?:recherche|looking for|objectif|target role|poste recherché|job target)[:\s-]*([^\n]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = searchRe.exec(text)) !== null) {
    const part = cleanRole(m[1] ?? "");
    if (part.length > 3) roles.push(part);
  }

  for (const pattern of ROLE_PATTERNS) {
    const matches = text.match(pattern) ?? [];
    for (const match of matches.slice(0, 6)) {
      const role = cleanRole(match);
      if (role.length > 5) roles.push(role);
    }
  }

  const lines = text.split("\n").slice(0, 25);
  for (const line of lines) {
    if (ROLE_PATTERNS.some((p) => p.test(line)) && line.length < 90) {
      roles.push(cleanRole(line));
    }
  }

  return uniqueSorted(roles).slice(0, 8);
}

function extractEmail(text: string): string {
  return text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? "";
}

function extractPhone(text: string): string {
  return text.match(/(?:\+?\d[\d\s().-]{7,}\d)/)?.[0]?.replace(/\s+/g, " ").trim() ?? "";
}

function extractName(text: string): string {
  const firstLines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 5);
  for (const line of firstLines) {
    if (line.length > 2 && line.length < 50 && !line.includes("@") && !/^\d/.test(line)) {
      if (/^[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ]+(\s+[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ'-]+)+$/.test(line)) {
        return line;
      }
    }
  }
  return "";
}

function extractLocation(text: string): string {
  const m = text.match(/(?:📍|location|localisation|based in|basé à|basé a)[:\s]*([^\n]+)/i);
  if (m?.[1]) return cleanRole(m[1]);
  const city = text.match(/\b(Paris|Lyon|Marseille|Toulouse|Bordeaux|Lille|Nantes|Remote|Télétravail|France)\b/i);
  return city?.[0] ?? "";
}

function inferDefaultTargetRoles(stack: string[]): string[] {
  const roles: string[] = [];
  const hasFrontend = stack.some((s) => ["react", "vue", "angular", "svelte", "nextjs"].includes(s));
  const hasBackend = stack.some((s) => ["node", "python", "java", "go", "php", "nestjs", "django"].includes(s));
  if (hasFrontend && hasBackend) roles.push("Développeur Full Stack");
  else if (hasFrontend) roles.push("Développeur Frontend");
  else if (hasBackend) roles.push("Développeur Backend");
  else roles.push("Développeur Software");
  if (stack.some((s) => ["docker", "k8s", "terraform", "aws"].includes(s))) {
    roles.push("Ingénieur DevOps");
  }
  return roles;
}

export function analyzeCvText(text: string, fileName: string): CvAnalysisResult {
  const stack = extractSkills(text);
  let targetRoles = extractTargetRoles(text);
  if (targetRoles.length === 0) targetRoles = inferDefaultTargetRoles(stack);

  const languages = extractLanguages(text);
  const cvMarkdown = text.startsWith("#") ? text : `# ${extractName(text) || "CV"}\n\n${text.trim()}`;

  return {
    fullName: extractName(text),
    email: extractEmail(text),
    phone: extractPhone(text),
    location: extractLocation(text),
    stack,
    languages: languages.length ? languages : ["français"],
    targetRoles,
    cvMarkdown,
    summary: [
      stack.length ? `${stack.length} compétences détectées` : null,
      targetRoles.length ? `postes: ${targetRoles.slice(0, 2).join(", ")}` : null,
      fileName ? `source: ${fileName}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}
