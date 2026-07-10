import express from "express";
const router = express.Router();

import {
  upsertRaidHelperEvent,
  getRaidHelperEvents,
  getRaidHelperStatsEvents,
  logCalendarVisit,
  isExtensionTelemetryEnabled,
  startExtensionScanRun,
  finishExtensionScanRun
} from "../db/raidhelper.js";

const MAX_SHORT_TEXT_LENGTH = 120;
const MAX_ERROR_TEXT_LENGTH = 500;
const MAX_SCAN_DURATION_MS = 10_800_000;
const MAX_SCAN_COUNT = 10_000;
const ALLOWED_SCAN_STATUSES = new Set(["completed", "failed"]);
const ALLOWED_VISIT_PAGES = new Set(["home", "radar", "calendar"]);

// Best-effort page-visit tracking. If it fails, still let the page load
// normally instead of making analytics break the response.
async function trackPageVisit(req, page) {
  if (!ALLOWED_VISIT_PAGES.has(page)) return;

  try {
    await logCalendarVisit({
      visitorId: req.get("x-visitor-id") || null,
      ipAddress: req.get("x-forwarded-for") || req.ip || null,
      userAgent: req.get("user-agent") || null,
      referer: req.get("referer") || null,
      route: req.originalUrl,
      page,
    });
  } catch (err) {
    console.error(`Failed to log ${page} visit:`, err);
  }
}

function asOptionalText(value, maxLength = MAX_SHORT_TEXT_LENGTH) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return null;
  return value.slice(0, maxLength);
}

function asRequiredText(value, maxLength = MAX_SHORT_TEXT_LENGTH) {
  const text = asOptionalText(value, maxLength);
  return text && text.trim() ? text.trim() : null;
}

function asBoundedInteger(value, { min = 0, max = MAX_SCAN_COUNT } = {}) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) return null;
  return number;
}

function validateExtensionScanStart(body = {}) {
  const extensionInstallId = asRequiredText(body.extensionInstallId);
  const scanType = asRequiredText(body.scanType);

  if (!extensionInstallId) return { error: "extensionInstallId is required" };
  if (!scanType) return { error: "scanType is required" };

  return {
    value: {
      extensionInstallId,
      scanType,
      extensionVersion: asOptionalText(body.extensionVersion, 40),
      scanMode: asOptionalText(body.scanMode, 40),
      guildId: asOptionalText(body.guildId, 80),
      guildName: asOptionalText(body.guildName, 120),
      channelId: asOptionalText(body.channelId, 80)
    }
  };
}

function validateExtensionScanFinish(body = {}) {
  const extensionInstallId = asRequiredText(body.extensionInstallId);
  const status = asRequiredText(body.status, 20) || "completed";
  const durationMs = asBoundedInteger(body.durationMs, { max: MAX_SCAN_DURATION_MS });

  if (!extensionInstallId) return { error: "extensionInstallId is required" };
  if (!ALLOWED_SCAN_STATUSES.has(status)) return { error: "status must be completed or failed" };
  if (body.durationMs !== undefined && durationMs === null) return { error: "durationMs is invalid" };

  const serverCount = asBoundedInteger(body.serverCount);
  const raidsFound = asBoundedInteger(body.raidsFound);
  const raidsImported = asBoundedInteger(body.raidsImported);
  const raidsUpdated = asBoundedInteger(body.raidsUpdated);
  const raidsFailed = asBoundedInteger(body.raidsFailed);

  if (body.serverCount !== undefined && serverCount === null) return { error: "serverCount is invalid" };
  if (body.raidsFound !== undefined && raidsFound === null) return { error: "raidsFound is invalid" };
  if (body.raidsImported !== undefined && raidsImported === null) return { error: "raidsImported is invalid" };
  if (body.raidsUpdated !== undefined && raidsUpdated === null) return { error: "raidsUpdated is invalid" };
  if (body.raidsFailed !== undefined && raidsFailed === null) return { error: "raidsFailed is invalid" };

  return {
    value: {
      extensionInstallId,
      status,
      serverCount,
      raidsFound,
      raidsImported,
      raidsUpdated,
      raidsFailed,
      durationMs,
      errorCode: asOptionalText(body.errorCode, 80),
      errorMessage: asOptionalText(body.errorMessage, MAX_ERROR_TEXT_LENGTH)
    }
  };
}

router.get("/events",  async (req, res, next) => {
  try {
    const response = await fetch(
      `https://raid-helper.xyz/api/v4/users/${process.env.RAID_HELPER_API_KEY}/events`
    );

    const events = await response.json();
    res.send(events);
  } catch (err) {
    next(err);
  }
});

router.post("/import",  async (req, res, next) => {
  try {
    const raids = req.body;

    const importedRaids = [];
    let insertedCount = 0;
    let updatedCount = 0;

    for (const raid of raids) {
      const importedRaid = await upsertRaidHelperEvent(raid);
      importedRaids.push(importedRaid);

      if (importedRaid.wasInserted) {
        insertedCount += 1;
      } else {
        updatedCount += 1;
      }
    }

    res.send({
      message: "Raid import saved",
      count: importedRaids.length,
      inserted: insertedCount,
      updated: updatedCount,
      raids: importedRaids,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/extension-scans/start", async (req, res) => {
  const validation = validateExtensionScanStart(req.body);
  if (validation.error) {
    return res.status(400).json({ error: validation.error });
  }

  try {
    if (!(await isExtensionTelemetryEnabled())) {
      return res.status(204).send();
    }

    const scanRun = await startExtensionScanRun({
      ...validation.value,
      userAgent: req.get("user-agent") || null,
      route: req.originalUrl,
    });

    res.status(201).json({
      scanRunId: scanRun.extension_scan_run_id,
    });
  } catch (err) {
    console.error("Failed to start extension scan telemetry:", err);
    res.status(204).send();
  }
});

router.post("/extension-scans/:scanRunId/complete", async (req, res) => {
  const scanRunId = Number(req.params.scanRunId);
  if (!Number.isInteger(scanRunId) || scanRunId <= 0) {
    return res.status(400).json({ error: "scanRunId is invalid" });
  }

  const validation = validateExtensionScanFinish(req.body);
  if (validation.error) {
    return res.status(400).json({ error: validation.error });
  }

  try {
    if (!(await isExtensionTelemetryEnabled())) {
      return res.status(204).send();
    }

    const scanRun = await finishExtensionScanRun({
      scanRunId,
      ...validation.value,
    });

    if (!scanRun) {
      return res.status(409).json({ error: "scan run is already finished or was not found" });
    }

    res.json({
      scanRunId: scanRun.extension_scan_run_id,
      status: scanRun.status,
    });
  } catch (err) {
    console.error("Failed to finish extension scan telemetry:", err);
    res.status(204).send();
  }
});

router.get("/imported",  async (req, res, next) => {
  try {
    await trackPageVisit(req, "calendar");

    const raids = await getRaidHelperEvents();
    console.log("Raids found:", raids.length);
    res.send(raids);
  } catch (err) {
    next(err);
  }
});


router.get("/stats", async (req, res, next) => {
  try {
    await trackPageVisit(req, req.query.page);

    res.json({
      raids: await getRaidHelperStatsEvents(),
    });

  } catch (err) {
    next(err);
  }
});




export default router;
