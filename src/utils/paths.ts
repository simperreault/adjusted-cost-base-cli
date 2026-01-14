import { homedir } from "os";
import { join } from "path";
import { mkdirSync, existsSync } from "fs";

const DATA_DIR_NAME = ".acb-cli";
const USERS_DIR_NAME = "users";

export function getDataDirectory(): string {
  return join(homedir(), DATA_DIR_NAME);
}

export function getUsersDirectory(): string {
  return join(getDataDirectory(), USERS_DIR_NAME);
}

export function getUserDatabasePath(username: string): string {
  return join(getUsersDirectory(), `${username}.db`);
}

export function ensureDirectoryExists(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

export function ensureDataDirectoriesExist(): void {
  ensureDirectoryExists(getDataDirectory());
  ensureDirectoryExists(getUsersDirectory());
}
