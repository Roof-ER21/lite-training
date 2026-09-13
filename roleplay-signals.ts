/** The legacy model protocol uses a phrase or a door/impact marker to end a scene.
 * Keep protocol markers separate from decorative UI cleanup.
 */
export function isRoleplayDoorSlam(text: string): boolean {
  return text.toLowerCase().includes('door slam') || text.includes('\u{1F6AA}\u{1F4A5}');
}
