import type { PreviewPreset, DetectContext } from "./preset-types";

function safeJson(content: string | null): Record<string, unknown> | null {
  if (!content) return null;
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function hasNodeDep(ctx: DetectContext, depName: string): boolean {
  const pkg = safeJson(ctx.files["package.json"]) as
    | { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> }
    | null;
  if (!pkg) return false;
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  return depName in all;
}

export const PRESETS: PreviewPreset[] = [
  {
    id: "next",
    name: "Next.js",
    icon: "simple-icons:nextdotjs",
    detect: (ctx) => hasNodeDep(ctx, "next"),
    command: "pnpm dev",
    port: 3000,
    installCommand: "pnpm install",
    installMarker: ["node_modules"],
    readyRegex: /Ready in \d+/i,
    urlExtractRegex: /(https?:\/\/[^\s]+)/,
    docUrl: "https://nextjs.org/docs",
  },
  {
    id: "nuxt",
    name: "Nuxt",
    icon: "simple-icons:nuxtdotjs",
    detect: (ctx) => hasNodeDep(ctx, "nuxt"),
    command: "pnpm dev",
    port: 3000,
    installCommand: "pnpm install",
    installMarker: ["node_modules"],
    readyRegex: /Nuxt .* ready in/i,
    urlExtractRegex: /(https?:\/\/[^\s]+)/,
  },
  {
    id: "vite",
    name: "Vite",
    icon: "simple-icons:vite",
    detect: (ctx) => hasNodeDep(ctx, "vite"),
    command: "pnpm dev",
    port: 5173,
    installCommand: "pnpm install",
    installMarker: ["node_modules"],
    readyRegex: /ready in \d+\s*ms/i,
    urlExtractRegex: /Local:\s+(https?:\/\/[^\s]+)/,
  },
  {
    id: "angular",
    name: "Angular",
    icon: "simple-icons:angular",
    detect: (ctx) => hasNodeDep(ctx, "@angular/core"),
    command: "pnpm start",
    port: 4200,
    installCommand: "pnpm install",
    installMarker: ["node_modules"],
    readyRegex: /Compiled successfully|Application bundle generation complete/i,
    urlExtractRegex: /(https?:\/\/[^\s]+)/,
  },
  {
    id: "spring-boot-maven",
    name: "Spring Boot (Maven)",
    icon: "simple-icons:springboot",
    detect: (ctx) => {
      const pom = ctx.files["pom.xml"];
      return !!(pom && /spring-boot-starter/.test(pom));
    },
    command: "./mvnw spring-boot:run",
    port: 8080,
    installCommand: "./mvnw dependency:resolve",
    installMarker: ["target"],
    readyRegex: /Started \w+Application in [\d.]+ seconds/i,
    urlExtractRegex: null,
    startTimeoutMs: 120_000,
  },
  {
    id: "spring-boot-gradle",
    name: "Spring Boot (Gradle)",
    icon: "simple-icons:springboot",
    detect: (ctx) => {
      const g = ctx.files["build.gradle"] ?? ctx.files["build.gradle.kts"];
      return !!(g && /spring-boot/.test(g));
    },
    command: "./gradlew bootRun",
    port: 8080,
    installCommand: "./gradlew --refresh-dependencies",
    installMarker: [".gradle"],
    readyRegex: /Started \w+Application in [\d.]+ seconds/i,
    urlExtractRegex: null,
    startTimeoutMs: 120_000,
  },
  {
    id: "django",
    name: "Django",
    icon: "simple-icons:django",
    detect: (ctx) =>
      ctx.files["manage.py"] !== null && ctx.files["manage.py"] !== undefined,
    command: "python manage.py runserver",
    port: 8000,
    installCommand: "pip install -r requirements.txt",
    installMarker: [".venv", "venv"],
    readyRegex: /Starting development server at/i,
    urlExtractRegex: /at\s+(https?:\/\/[^\s]+)/,
  },
  {
    id: "fastapi",
    name: "FastAPI",
    icon: "simple-icons:fastapi",
    detect: (ctx) => {
      const req = ctx.files["requirements.txt"] ?? "";
      const pyproject = ctx.files["pyproject.toml"] ?? "";
      return /fastapi/i.test((req ?? "") + (pyproject ?? ""));
    },
    command: "uvicorn main:app --reload",
    port: 8000,
    installCommand: "pip install -r requirements.txt",
    installMarker: [".venv", "venv"],
    readyRegex: /Application startup complete|Uvicorn running on/i,
    urlExtractRegex: /running on\s+(https?:\/\/[^\s]+)/,
  },
  {
    id: "flask",
    name: "Flask",
    icon: "simple-icons:flask",
    detect: (ctx) => {
      const req = ctx.files["requirements.txt"] ?? "";
      return /^flask/im.test(req ?? "");
    },
    command: "flask --app app run",
    port: 5000,
    installCommand: "pip install -r requirements.txt",
    installMarker: [".venv", "venv"],
    readyRegex: /Running on\s+http/i,
    urlExtractRegex: /Running on\s+(https?:\/\/[^\s]+)/,
  },
  {
    id: "go-generic",
    name: "Go",
    icon: "simple-icons:go",
    detect: (ctx) =>
      ctx.files["go.mod"] !== null && ctx.files["go.mod"] !== undefined,
    command: "go run .",
    port: 8080,
    installCommand: "go mod download",
    installMarker: ["go.sum"],
    readyRegex: null,
    urlExtractRegex: /(https?:\/\/[^\s]+)/,
  },
  {
    id: "static",
    name: "Static HTML",
    icon: "simple-icons:html5",
    detect: (ctx) =>
      ctx.files["index.html"] !== null &&
      ctx.files["index.html"] !== undefined &&
      !ctx.files["package.json"] &&
      !ctx.files["pom.xml"],
    command: "npx serve -l {port} .",
    port: 3000,
    installCommand: null,
    installMarker: null,
    readyRegex: /Accepting connections at/i,
    urlExtractRegex: /(https?:\/\/[^\s]+)/,
  },
];
