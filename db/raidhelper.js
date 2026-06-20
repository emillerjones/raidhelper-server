import db from "./client.js";

export async function upsertRaidHelperEvent(raid) {
  const sql = `
    INSERT INTO raidhelper_events (
      event_id,
      softres_id,
      guild_id,
      guild_name,
      guild_icon_url,
      channel_id,
      raid_name,
      raid_notes,
      title,
      start_time,
      signup_count,
      signup_max,
      raidhelper_url,
      softres_url,
      raw_json,
      raid_leader
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    ON CONFLICT (event_id)
    DO UPDATE SET
      softres_id = EXCLUDED.softres_id,
      guild_id = EXCLUDED.guild_id,
      guild_name = EXCLUDED.guild_name,
      guild_icon_url = EXCLUDED.guild_icon_url,
      channel_id = EXCLUDED.channel_id,
      raid_name = EXCLUDED.raid_name,
      raid_notes = EXCLUDED.raid_notes,
      title = EXCLUDED.title,
      start_time = EXCLUDED.start_time,
      signup_count = EXCLUDED.signup_count,
      signup_max = EXCLUDED.signup_max,
      raidhelper_url = EXCLUDED.raidhelper_url,
      softres_url = EXCLUDED.softres_url,
      raw_json = EXCLUDED.raw_json,
      updated_at = NOW(),
      raid_leader = EXCLUDED.raid_leader
    RETURNING *;
  `;

  const { rows } = await db.query(sql, [
    raid.eventId,
    raid.softresId,
    raid.guildId,
    raid.guildName,
    raid.guildIconUrl,
    raid.channelId,
    raid.raidName,
    raid.raidNotes,
    raid.title,
    raid.startTime,
    raid.signupCount,
    raid.signupMax,
    raid.raidHelperUrl,
    raid.softResUrl || raid.softresUrl,
    raid,
    raid.raidLeader
  ]);

  return rows[0];
}


export async function getRaidHelperEvents() {
  const { rows } = await db.query(
    `
    SELECT *
    FROM raidhelper_events
    ORDER BY start_time ASC
    `
  );

  return rows;
}