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
    RETURNING *, (xmax = 0) AS inserted;
  `;
  // (xmax = 0) is a Postgres trick for telling INSERT apart from UPDATE in a
  // single upsert statement: xmax is the id of the transaction that last
  // deleted/updated a row version. A row that was just freshly inserted by
  // this command has xmax = 0 (untouched), so "inserted" comes back true.
  // If the ON CONFLICT branch fired instead (an existing row got updated),
  // xmax is set to the current transaction, so "inserted" comes back false.

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

  const row = rows[0];
  return {
    ...row,
    wasInserted: row.inserted === true,
  };
}


export async function getRaidHelperEvents() {
  const { rows } = await db.query(
    `
    SELECT *
    FROM raidhelper_events
    WHERE start_time >= CURRENT_DATE
      AND start_time < CURRENT_DATE + INTERVAL '8 days'
    ORDER BY start_time ASC
    `
  );

  return rows;
}

export async function logCalendarVisit(visit) {
  const sql = `
    INSERT INTO calendar_visits (
      visitor_id,
      ip_address,
      user_agent,
      referer,
      route
    )
    VALUES ($1,$2,$3,$4,$5)
    RETURNING *;
  `;

  const { rows } = await db.query(sql, [
    visit.visitorId,
    visit.ipAddress,
    visit.userAgent,
    visit.referer,
    visit.route
  ]);

  return rows[0];
}

export async function getAppSetting(key, fallbackValue = null) {
  const { rows } = await db.query(
    `
    SELECT setting_value
    FROM app_settings
    WHERE setting_key = $1
    `,
    [key]
  );

  return rows[0]?.setting_value ?? fallbackValue;
}

export async function isExtensionTelemetryEnabled() {
  return (await getAppSetting("extension_telemetry_enabled", true)) === true;
}

export async function startExtensionScanRun(scanRun) {
  const sql = `
    INSERT INTO extension_scan_runs (
      extension_install_id,
      extension_version,
      scan_type,
      scan_mode,
      guild_id,
      guild_name,
      channel_id,
      user_agent,
      route
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    RETURNING *;
  `;

  const { rows } = await db.query(sql, [
    scanRun.extensionInstallId,
    scanRun.extensionVersion,
    scanRun.scanType,
    scanRun.scanMode,
    scanRun.guildId,
    scanRun.guildName,
    scanRun.channelId,
    scanRun.userAgent,
    scanRun.route
  ]);

  return rows[0];
}

export async function finishExtensionScanRun(scanRun) {
  const sql = `
    UPDATE extension_scan_runs
    SET
      status = $3,
      server_count = $4,
      raids_found = $5,
      raids_imported = $6,
      raids_updated = $7,
      raids_failed = $8,
      duration_ms = $9,
      error_code = $10,
      error_message = $11,
      completed_at = NOW(),
      updated_at = NOW()
    WHERE extension_scan_run_id = $1
      AND extension_install_id = $2
      AND status = 'started'
    RETURNING *;
  `;

  const { rows } = await db.query(sql, [
    scanRun.scanRunId,
    scanRun.extensionInstallId,
    scanRun.status,
    scanRun.serverCount,
    scanRun.raidsFound,
    scanRun.raidsImported,
    scanRun.raidsUpdated,
    scanRun.raidsFailed,
    scanRun.durationMs,
    scanRun.errorCode,
    scanRun.errorMessage
  ]);

  return rows[0] || null;
}

export async function getStatsByWeekDay() {
  const { rows } = await db.query(
    `
    SELECT
      TRIM(TO_CHAR(start_time, 'Day')) AS day_of_week,
      COUNT(*) AS event_count
    FROM raidhelper_events
    GROUP BY EXTRACT(DOW FROM start_time), TRIM(TO_CHAR(start_time, 'Day'))
    ORDER BY EXTRACT(DOW FROM start_time);
    `
  );

  return rows;
}
