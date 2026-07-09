import express from "express";
const router = express.Router();

import { upsertRaidHelperEvent, getRaidHelperEvents, getStatsByWeekDay, logCalendarVisit } from "../db/raidhelper.js";

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

router.get("/imported",  async (req, res, next) => {
  try {
    // This is best-effort visitor tracking. If it fails, still let the
    // calendar load normally instead of making analytics break the page.
    try {
      await logCalendarVisit({
        visitorId: req.get("x-visitor-id") || null,
        ipAddress: req.get("x-forwarded-for") || req.ip || null,
        userAgent: req.get("user-agent") || null,
        referer: req.get("referer") || null,
        route: req.originalUrl,
      });
    } catch (visitErr) {
      console.error("Failed to log calendar visit:", visitErr);
    }

    const raids = await getRaidHelperEvents();
    console.log("Raids found:", raids.length);
    res.send(raids);
  } catch (err) {
    next(err);
  }
});


router.get("/stats", async (req, res, next) => {
  try {
    const events = await getRaidHelperEvents();
    const guildMap = new Map();
    for (const event of events) {
      if (!guildMap.has(event.guild_id)) {
        guildMap.set(event.guild_id, {
          guild_id: event.guild_id,
          guild_name: event.guild_name,
          guild_icon_url: event.guild_icon_url,
          raids: [],
        });
      }
      guildMap.get(event.guild_id).raids.push(event);
    }
    const groupedEvents = [...guildMap.values()];

    const statsByWeekday = await getStatsByWeekDay();



    res.json({
      guilds: groupedEvents,
      raidsByDay: statsByWeekday,
    });

  } catch (err) {
    next(err);
  }
});




export default router;
