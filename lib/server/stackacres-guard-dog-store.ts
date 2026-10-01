import "server-only";

import { randomUUID } from "node:crypto";
import { GUARD_DOG_CAP, type GuardDog } from "@/lib/stackacres/guard-dog";
import { adminClient } from "./supabase-admin";

/**
 * Persistence for the guard dogs a player keeps (lib/stackacres/guard-dog.ts),
 * in `homestead_guard_dogs`.
 *
 * Paying is the service's job and happens before a dog is written here.
 * `add_homestead_guard_dog` (20261001195736_stackacres_guard_dogs.sql) holds
 * the cap under a lock and lets the square's unique index refuse a second
 * dog on one square; the memory branch makes the same checks in one process.
 */

declare global {
  var __riverRoomStackAcresGuardDogs: Map<string, GuardDog[]> | undefined;
}

const memoryDogs = globalThis.__riverRoomStackAcresGuardDogs ?? new Map<string, GuardDog[]>();
globalThis.__riverRoomStackAcresGuardDogs = memoryDogs;

export function __resetStackAcresGuardDogsForTest(): void {
  memoryDogs.clear();
}

export type DogAddition = { added: string } | "taken" | "full";
export type DogMove = "ok" | "taken" | "missing";

export function stackAcresGuardDogFromBatchRow(row: { id: unknown; tx: number | string; ty: number | string }): GuardDog {
  return { id: String(row.id), tx: Number(row.tx), ty: Number(row.ty) };
}

export async function listStackAcresGuardDogs(profileId: string): Promise<GuardDog[]> {
  const supabase = adminClient();
  if (!supabase) return (memoryDogs.get(profileId) ?? []).map((dog) => ({ ...dog }));
  const { data, error } = await supabase
    .from("homestead_guard_dogs")
    .select("id, tx, ty")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not read your dogs: ${error.message}`);
  return (data ?? []).map(stackAcresGuardDogFromBatchRow);
}

/** Writes a dog the caller has already paid for. */
export async function addStackAcresGuardDog(profileId: string, tx: number, ty: number): Promise<DogAddition> {
  const supabase = adminClient();
  if (!supabase) {
    const dogs = memoryDogs.get(profileId) ?? [];
    if (dogs.length >= GUARD_DOG_CAP) return "full";
    if (dogs.some((dog) => dog.tx === tx && dog.ty === ty)) return "taken";
    const dog: GuardDog = { id: randomUUID(), tx, ty };
    memoryDogs.set(profileId, [...dogs, dog]);
    return { added: dog.id };
  }
  const { data, error } = await supabase.rpc("add_homestead_guard_dog", {
    p_profile_id: profileId,
    p_tx: tx,
    p_ty: ty,
    p_cap: GUARD_DOG_CAP,
  });
  if (error) throw new Error(`Could not bring the dog home: ${error.message}`);
  const outcome = String(data);
  if (outcome === "taken" || outcome === "full") return outcome;
  return { added: outcome };
}

/** Moves a dog the player owns to another square. Free. */
export async function moveStackAcresGuardDog(profileId: string, id: string, tx: number, ty: number): Promise<DogMove> {
  const supabase = adminClient();
  if (!supabase) {
    const dogs = memoryDogs.get(profileId) ?? [];
    const dog = dogs.find((candidate) => candidate.id === id);
    if (!dog) return "missing";
    if (dogs.some((other) => other.id !== id && other.tx === tx && other.ty === ty)) return "taken";
    dog.tx = tx;
    dog.ty = ty;
    return "ok";
  }
  const { data, error } = await supabase
    .from("homestead_guard_dogs")
    .update({ tx, ty, updated_at: new Date().toISOString() })
    .eq("profile_id", profileId)
    .eq("id", id)
    .select("id");
  if (error) {
    if (error.code === "23505") return "taken";
    throw new Error(`Could not move the dog: ${error.message}`);
  }
  return data && data.length > 0 ? "ok" : "missing";
}
