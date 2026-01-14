import { readdirSync, existsSync } from "fs";
import {
  getUsersDirectory,
  getUserDatabasePath,
  ensureDataDirectoriesExist,
} from "../utils/paths.ts";
import {
  createDatabaseConnection,
  type AppDatabase,
} from "../db/index.ts";

export interface UserInfo {
  username: string;
  hasPassword: boolean;
}

export function listUsers(): string[] {
  ensureDataDirectoriesExist();
  const usersDir = getUsersDirectory();

  if (!existsSync(usersDir)) {
    return [];
  }

  const files = readdirSync(usersDir);
  return files
    .filter((f) => f.endsWith(".db"))
    .map((f) => f.replace(".db", ""));
}

export function userExists(username: string): boolean {
  const dbPath = getUserDatabasePath(username);
  return existsSync(dbPath);
}

// Note: Password protection not yet implemented with bun:sqlite
export function isPasswordProtected(_username: string): boolean {
  return false;
}

export function validatePassword(_username: string, _password: string): boolean {
  return true;
}

export function createUser(username: string, _password?: string): AppDatabase {
  if (userExists(username)) {
    throw new Error(`User "${username}" already exists`);
  }

  return createDatabaseConnection({ username });
}

export function openUserDatabase(
  username: string,
  _password?: string
): AppDatabase {
  if (!userExists(username)) {
    throw new Error(`User "${username}" does not exist`);
  }

  return createDatabaseConnection({ username });
}

export function getUserInfo(username: string): UserInfo | null {
  if (!userExists(username)) {
    return null;
  }

  return {
    username,
    hasPassword: false,
  };
}
