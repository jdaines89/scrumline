"use client";

import { Avatar } from "@/components/avatar";
import { PicturePicker } from "@/components/picture-picker";
import { supabase } from "@/lib/supabase";
import type { Member } from "@/lib/types";

/** Your profile picture: what's in the circle is what everyone sees next to your messages. */
export function AvatarPicker({ me, onMessage }: { me: Member; onMessage: (ok: boolean, text: string) => void }) {
  async function save(blob: Blob) {
    const path = `${me.user_id}/${crypto.randomUUID()}.jpg`;
    const up = await supabase.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg" });
    if (up.error) throw up.error;
    const { error } = await supabase.from("members").update({ avatar_path: path }).eq("user_id", me.user_id);
    if (error) { await supabase.storage.from("avatars").remove([path]); throw error; }
    if (me.avatar_path) await supabase.storage.from("avatars").remove([me.avatar_path]);
    window.location.reload();
  }

  async function remove() {
    if (!me.avatar_path) return;
    const { error } = await supabase.from("members").update({ avatar_path: null }).eq("user_id", me.user_id);
    if (error) throw error;
    await supabase.storage.from("avatars").remove([me.avatar_path]);
    window.location.reload();
  }

  return (
    <PicturePicker label="Profile picture, shown next to your messages in chat" preview={<Avatar member={me} size={56} />}
      has={!!me.avatar_path} onSave={save} onRemove={remove} onMessage={onMessage} />
  );
}
