/** Typed view of engine/file-utils.js. */
export function safeJoin(root: string, relativePath: string): string | null
export function normalizeUserPath(rawPath: string): string
export function sanitizeFolderName(raw: string): string | null
export function computeTruncation(declaredCount: number, maxCount: number): { available: number; shown: number } | null
export function getUniqueFilePath(filePath: string): Promise<string>
export function getUniqueFolderPath(folderPath: string): Promise<string>
export function ensureDir(dirPath: string): Promise<void>
export function formatBytes(bytes: number): string
export function formatSpeed(bytesPerSec: number): string
