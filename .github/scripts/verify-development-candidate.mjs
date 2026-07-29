import { createHash } from "node:crypto";
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync
} from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_BASE_PATH = "/animal_hotel-preview-dev/";
const EXPECTED_BUSINESS_DATABASE = "lantern-inn-p0a-dev";
const EXPECTED_DIAGNOSTICS_DATABASE = "lantern-inn-diagnostics-dev";
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SOURCE_COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..", "..");
const manifestPath = join(repositoryRoot, "deployment-manifest.json");
const stagingDirectory = join(repositoryRoot, ".pages-site");
const allowedControlFiles = new Set([
  ".gitattributes",
  ".gitignore",
  ".nojekyll",
  ".github/scripts/verify-development-candidate.mjs",
  ".github/workflows/deploy-development.yml",
  "README.md",
  "THIRD_PARTY_NOTICES.md",
  "deployment-manifest.json"
]);
const allowedLicenseMetadata = new Set([
  "licenses/dexie-4.4.4.txt",
  "licenses/earcut-3.2.3.txt",
  "licenses/eventemitter3-5.0.4.txt",
  "licenses/gifuct-js-2.1.2.txt",
  "licenses/ismobilejs-1.1.1.txt",
  "licenses/js-binary-schema-parser-2.0.3.txt",
  "licenses/parse-svg-path-0.2.0.txt",
  "licenses/pixi-colord-2.9.6.txt",
  "licenses/pixi.js-8.19.0.txt",
  "licenses/react-19.2.8.txt",
  "licenses/react-dom-19.2.8.txt",
  "licenses/scheduler-0.27.0.txt",
  "licenses/tiny-lru-11.4.7.txt",
  "licenses/types-earcut-3.0.0.txt",
  "licenses/webgpu-types-0.1.71.txt",
  "licenses/workbox-7.4.1.txt",
  "licenses/xmldom-0.8.13.txt",
  "licenses/zod-4.4.3.txt"
]);
const forbiddenRuntimeRoots = [
  ".private-diagnostics/",
  "assets/source/",
  "docs/",
  "e2e/",
  "node_modules/",
  "src/",
  "tools/"
];
const forbiddenRuntimeExtensions = new Set([
  ".map",
  ".ts",
  ".tsx",
  ".jsx",
  ".mjs"
]);
const forbiddenTextPatterns = [
  ["调试桥全局名", /__LANTERN_INN_DEBUG__/u],
  ["调试桥安装入口", /installLanternInnDebugBridge/u],
  ["Source Map 引用", /sourceMappingURL=/u],
  ["Windows 私有绝对路径", /[a-zA-Z]:\\Users\\/u]
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isAllowedControlFile(filePath) {
  return (
    allowedControlFiles.has(filePath) ||
    allowedLicenseMetadata.has(filePath)
  );
}

function assertExactKeys(value, keys, label) {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${label} 必须为对象。`
  );
  const actual = Object.keys(value).sort(comparePaths);
  const expected = [...keys].sort(comparePaths);
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} 含未知或缺失字段。`
  );
}

function relativePosix(filePath) {
  return relative(repositoryRoot, filePath).split(sep).join("/");
}

function listFiles(directory) {
  const files = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    const relativePath = relativePosix(absolutePath);

    if (
      relativePath === ".git" ||
      relativePath.startsWith(".git/") ||
      relativePath === ".pages-site" ||
      relativePath.startsWith(".pages-site/")
    ) {
      continue;
    }

    if (entry.isSymbolicLink()) {
      throw new Error(`公开仓库不得包含符号链接：${relativePath}`);
    }

    if (entry.isDirectory()) {
      files.push(...listFiles(absolutePath));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    } else {
      throw new Error(`公开仓库包含不支持的文件类型：${relativePath}`);
    }
  }

  return files;
}

function sha256File(filePath) {
  return createHash("sha256")
    .update(readFileSync(filePath))
    .digest("hex");
}

function parseManifest() {
  const value = JSON.parse(readFileSync(manifestPath, "utf8"));
  assertExactKeys(
    value,
    [
      "publicDeploymentManifestVersion",
      "channel",
      "sourceCommit",
      "buildId",
      "builtAt",
      "basePath",
      "storage",
      "runtimeFileCount",
      "runtimeTotalBytes",
      "fileSetSha256",
      "files"
    ],
    "公开部署清单"
  );
  assert(
    value.publicDeploymentManifestVersion === 1,
    "公开部署清单版本不受支持。"
  );
  assert(value.channel === "development", "公开候选通道必须为 development。");
  assert(
    SOURCE_COMMIT_PATTERN.test(value.sourceCommit),
    "sourceCommit 必须为完整的小写 Git SHA。"
  );
  assert(value.buildId === value.sourceCommit, "buildId 必须等于 sourceCommit。");
  assert(
    new Date(value.builtAt).toISOString() === value.builtAt,
    "builtAt 必须为规范 UTC ISO 时间。"
  );
  assert(value.basePath === EXPECTED_BASE_PATH, "开发服基路径不匹配。");
  assertExactKeys(
    value.storage,
    ["businessDatabase", "diagnosticsDatabase"],
    "开发服存储契约"
  );
  assert(
    value.storage.businessDatabase === EXPECTED_BUSINESS_DATABASE &&
      value.storage.diagnosticsDatabase === EXPECTED_DIAGNOSTICS_DATABASE,
    "开发服数据库身份不匹配。"
  );
  assert(Array.isArray(value.files) && value.files.length > 0, "文件清单为空。");

  const seenPaths = new Set();
  const files = value.files.map((entry, index) => {
    assertExactKeys(entry, ["path", "bytes", "sha256"], `文件条目 ${index}`);
    assert(
      typeof entry.path === "string" &&
        entry.path.length > 0 &&
        !entry.path.startsWith("/") &&
        !entry.path.includes("\\") &&
        !entry.path.split("/").includes("..") &&
        entry.path !== "deployment-manifest.json",
      `文件条目 ${index} 路径不安全。`
    );
    assert(!seenPaths.has(entry.path), `文件路径重复：${entry.path}`);
    assert(
      Number.isSafeInteger(entry.bytes) && entry.bytes >= 0,
      `文件字节数无效：${entry.path}`
    );
    assert(SHA256_PATTERN.test(entry.sha256), `文件 SHA-256 无效：${entry.path}`);
    seenPaths.add(entry.path);
    return {
      path: entry.path,
      bytes: entry.bytes,
      sha256: entry.sha256
    };
  });

  assert(
    value.runtimeFileCount === files.length,
    "runtimeFileCount 与文件清单不一致。"
  );
  assert(
    value.runtimeTotalBytes ===
      files.reduce((total, entry) => total + entry.bytes, 0),
    "runtimeTotalBytes 与文件清单不一致。"
  );
  assert(
    createHash("sha256")
      .update(JSON.stringify(files))
      .digest("hex") === value.fileSetSha256,
    "文件集合 SHA-256 不匹配。"
  );

  return {
    ...value,
    files
  };
}

function assertRuntimeBoundaries(filePaths) {
  const textExtensions = new Set([
    ".css",
    ".html",
    ".js",
    ".json",
    ".webmanifest"
  ]);

  for (const filePath of filePaths) {
    const relativePath = relativePosix(filePath);
    const extension = extname(relativePath);

    assert(
      !forbiddenRuntimeRoots.some((root) => relativePath.startsWith(root)),
      `公开候选包含禁止目录：${relativePath}`
    );
    assert(
      !forbiddenRuntimeExtensions.has(extension),
      `公开候选包含禁止扩展名：${relativePath}`
    );
    assert(!lstatSync(filePath).isSymbolicLink(), `运行文件不得为符号链接：${relativePath}`);

    if (textExtensions.has(extension)) {
      const contents = readFileSync(filePath, "utf8");

      for (const [label, pattern] of forbiddenTextPatterns) {
        assert(!pattern.test(contents), `公开候选包含${label}：${relativePath}`);
      }
    }
  }
}

function assertPagesContract(manifest, runtimeFiles) {
  const indexHtml = readFileSync(join(repositoryRoot, "index.html"), "utf8");
  const webManifest = JSON.parse(
    readFileSync(join(repositoryRoot, "manifest.webmanifest"), "utf8")
  );
  const serviceWorker = readFileSync(join(repositoryRoot, "sw.js"), "utf8");
  const runtimeText = runtimeFiles
    .filter((filePath) => extname(filePath) === ".js")
    .map((filePath) => readFileSync(filePath, "utf8"))
    .join("\n");

  assert(
    webManifest.start_url === EXPECTED_BASE_PATH &&
      webManifest.scope === EXPECTED_BASE_PATH,
    "PWA Manifest 的 start_url／scope 不是开发服基路径。"
  );
  assert(
    indexHtml.includes(`${EXPECTED_BASE_PATH}assets/`) &&
      indexHtml.includes(`${EXPECTED_BASE_PATH}manifest.webmanifest`),
    "index.html 缺少开发服基路径引用。"
  );
  assert(
    serviceWorker.includes("SKIP_WAITING") &&
      serviceWorker.includes("createHandlerBoundToURL"),
    "Service Worker 缺少更新协议或导航回退。"
  );

  for (const requiredIdentity of [
    manifest.buildId,
    manifest.builtAt,
    EXPECTED_BASE_PATH,
    EXPECTED_BUSINESS_DATABASE,
    EXPECTED_DIAGNOSTICS_DATABASE
  ]) {
    assert(
      runtimeText.includes(requiredIdentity),
      `运行 bundle 缺少身份：${requiredIdentity}`
    );
  }
}

function copyToStage(relativePath) {
  const sourcePath = resolve(repositoryRoot, relativePath);
  const targetPath = resolve(stagingDirectory, relativePath);
  const stageRoot = resolve(stagingDirectory);

  assert(
    targetPath.startsWith(`${stageRoot}${sep}`),
    `Pages 暂存路径越界：${relativePath}`
  );
  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(sourcePath, targetPath);
}

const manifest = parseManifest();
const repositoryFiles = listFiles(repositoryRoot);
const controlFiles = repositoryFiles
  .map(relativePosix)
  .filter(isAllowedControlFile)
  .sort(comparePaths);
const unknownControlFiles = repositoryFiles
  .map(relativePosix)
  .filter(
    (filePath) =>
      (filePath.startsWith(".github/") || filePath.startsWith(".")) &&
      !allowedControlFiles.has(filePath)
  );

assert(
  unknownControlFiles.length === 0,
  `公开仓库包含未知控制文件：${unknownControlFiles.join(", ")}`
);
assert(
  controlFiles.includes(".github/workflows/deploy-development.yml") &&
    controlFiles.includes(".github/scripts/verify-development-candidate.mjs") &&
    controlFiles.includes(".nojekyll"),
  "公开部署所需控制文件不完整。"
);

const runtimeFiles = repositoryFiles.filter(
  (filePath) => !isAllowedControlFile(relativePosix(filePath))
);
const actualRuntimePaths = runtimeFiles.map(relativePosix).sort(comparePaths);
const expectedRuntimePaths = manifest.files
  .map((entry) => entry.path)
  .sort(comparePaths);

assert(
  JSON.stringify(actualRuntimePaths) === JSON.stringify(expectedRuntimePaths),
  "公开仓库运行文件集合与部署清单不一致。"
);

for (const entry of manifest.files) {
  const filePath = resolve(repositoryRoot, entry.path);
  assert(
    filePath.startsWith(`${repositoryRoot}${sep}`),
    `运行文件越过仓库根：${entry.path}`
  );
  assert(statSync(filePath).size === entry.bytes, `文件字节数不匹配：${entry.path}`);
  assert(sha256File(filePath) === entry.sha256, `文件 SHA-256 不匹配：${entry.path}`);
}

assertRuntimeBoundaries(runtimeFiles);
assertPagesContract(manifest, runtimeFiles);

rmSync(stagingDirectory, { recursive: true, force: true });
mkdirSync(stagingDirectory, { recursive: true });

for (const entry of manifest.files) {
  copyToStage(entry.path);
}

for (const metadataPath of [
  ".nojekyll",
  "THIRD_PARTY_NOTICES.md",
  "deployment-manifest.json",
  ...allowedLicenseMetadata
]) {
  copyToStage(metadataPath);
}

process.stdout.write(
  `开发服公开候选校验通过：build ${manifest.buildId}，${manifest.runtimeFileCount} 个运行文件，集合 SHA-256 ${manifest.fileSetSha256}。\n`
);
