use crate::error::{self, Result};
use chrono::{NaiveDate, NaiveTime};
use serde::{Deserialize, Serialize};
fn invalid_schedule(message: &'static str) -> error::Error {
    error::Error(
        axum::http::StatusCode::BAD_REQUEST,
        "invalid_schedule",
        message,
    )
}
fn timezone() -> String {
    "Asia/Shanghai".into()
}
fn one() -> u32 {
    1
}
fn calendar() -> String {
    "calendar".into()
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Schedule {
    pub start_date: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_time: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_time: Option<String>,
    #[serde(default = "timezone")]
    pub timezone: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repeat: Option<Repeat>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Repeat {
    pub unit: String,
    #[serde(default = "one")]
    pub interval: u32,
    #[serde(default = "calendar")]
    pub mode: String,
    #[serde(default)]
    pub weekdays: Vec<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub until: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub count: Option<u32>,
}
pub fn date(s: &str) -> Result<NaiveDate> {
    if s.len() != 10
        || !s.bytes().enumerate().all(|(i, b)| {
            if i == 4 || i == 7 {
                b == b'-'
            } else {
                b.is_ascii_digit()
            }
        })
        || s.starts_with("0000")
    {
        return Err(invalid_schedule(
            "日期必须是有效的 YYYY-MM-DD（年份 0001–9999）",
        ));
    }
    NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .map_err(|_| invalid_schedule("日期不存在，请检查年月日"))
}
fn time(s: &str) -> Result<NaiveTime> {
    if s.len() != 5 {
        return Err(invalid_schedule("时间必须为 00:00–23:59"));
    }
    NaiveTime::parse_from_str(s, "%H:%M").map_err(|_| invalid_schedule("时间必须为 00:00–23:59"))
}
impl Schedule {
    pub fn day(start_date: String) -> Self {
        Self {
            start_date,
            end_date: None,
            start_time: None,
            end_time: None,
            timezone: timezone(),
            repeat: None,
        }
    }
    pub fn validate(&self) -> Result<()> {
        let start = date(&self.start_date)?;
        let end = self
            .end_date
            .as_deref()
            .map(date)
            .transpose()?
            .unwrap_or(start);
        if self.timezone != "Asia/Shanghai" {
            return Err(invalid_schedule("当前仅支持 Asia/Shanghai 时区"));
        }
        if end < start {
            return Err(invalid_schedule("结束日期不能早于开始日期"));
        }
        let st = self.start_time.as_deref().map(time).transpose()?;
        let et = self.end_time.as_deref().map(time).transpose()?;
        if end == start && st.zip(et).is_some_and(|(a, b)| b < a) {
            return Err(invalid_schedule("同日结束时间不能早于开始时间"));
        }
        if let Some(r) = &self.repeat {
            if !["day", "week", "month", "year"].contains(&r.unit.as_str())
                || !["calendar", "relative"].contains(&r.mode.as_str())
                || r.interval == 0
                || r.interval > 1000
                || r.count == Some(0)
                || (r.until.is_some() && r.count.is_some())
            {
                return Err(invalid_schedule(
                    "重复单位或基准无效；间隔必须为 1–1000，总次数至少为 1，次数与截至日期不能同时设置",
                ));
            }
            if r.weekdays.iter().any(|d| *d > 6)
                || (r.unit == "week" && r.weekdays.is_empty())
                || (r.unit != "week" && !r.weekdays.is_empty())
            {
                return Err(invalid_schedule(
                    "每周重复必须选择周一至周日，其他重复单位不能设置星期",
                ));
            }
            let mut days = r.weekdays.clone();
            days.sort();
            days.dedup();
            if days.len() != r.weekdays.len() {
                return Err(invalid_schedule("重复星期不能重复选择"));
            }
            if r.until
                .as_deref()
                .map(date)
                .transpose()?
                .is_some_and(|d| d < start)
            {
                return Err(invalid_schedule("重复截至日期不能早于开始日期"));
            }
        }
        Ok(())
    }
}

use chrono::{Datelike, Duration, NaiveDateTime, Timelike};
fn shift_month(d: NaiveDate, months: u32) -> Result<NaiveDate> {
    let total = d.year() as i64 * 12 + i64::from(d.month0()) + i64::from(months);
    let y = i32::try_from(total / 12).map_err(|_| error::invalid())?;
    let m = (total % 12) as u32 + 1;
    (1..=d.day())
        .rev()
        .find_map(|day| NaiveDate::from_ymd_opt(y, m, day))
        .ok_or_else(error::invalid)
}
fn advance(d: NaiveDate, unit: &str, n: u32) -> Result<NaiveDate> {
    match unit {
        "day" => d.checked_add_signed(Duration::days(i64::from(n))),
        "week" => d.checked_add_signed(Duration::days(i64::from(n) * 7)),
        "month" => return shift_month(d, n),
        "year" => return shift_month(d, n.checked_mul(12).ok_or_else(error::invalid)?),
        _ => None,
    }
    .ok_or_else(error::invalid)
}
/// `generated` counts real rows including the original, never skipped calendar periods.
pub fn next(
    current: &Schedule,
    anchor: &Schedule,
    completed: NaiveDateTime,
    generated: u32,
) -> Result<Option<Schedule>> {
    current.validate()?;
    anchor.validate()?;
    let Some(r) = &current.repeat else {
        return Ok(None);
    };
    if r.count.is_some_and(|c| generated >= c) {
        return Ok(None);
    }
    let start = date(&current.start_date)?;
    let original = date(&anchor.start_date)?;
    let candidate = if r.mode == "relative" {
        let mut d = advance(completed.date(), &r.unit, r.interval)?;
        if r.unit == "week" {
            while !r.weekdays.contains(&d.weekday().num_days_from_monday()) {
                d = d
                    .checked_add_signed(Duration::days(1))
                    .ok_or_else(error::invalid)?;
            }
        }
        d
    } else {
        let threshold = completed.date().max(start);
        if r.unit == "day" {
            let elapsed = (threshold - original).num_days().max(0) as u32;
            let mut n = elapsed / r.interval;
            let mut candidate = advance(original, "day", n * r.interval)?;
            let future = |d: NaiveDate| {
                d > start
                    && if let Some(t) = &current.start_time {
                        d.and_time(time(t).unwrap()) > completed
                    } else {
                        d > completed.date()
                    }
            };
            if !future(candidate) {
                n += 1;
                candidate = advance(
                    original,
                    "day",
                    n.checked_mul(r.interval).ok_or_else(error::invalid)?,
                )?;
            }
            candidate
        } else if r.unit == "week" {
            let monday =
                original - Duration::days(i64::from(original.weekday().num_days_from_monday()));
            let mut d = threshold;
            loop {
                let weeks = (d - monday).num_days() / 7;
                let future = d > start
                    && if let Some(t) = &current.start_time {
                        d.and_time(time(t)?) > completed
                    } else {
                        d > completed.date()
                    };
                if weeks >= 0
                    && weeks % i64::from(r.interval) == 0
                    && r.weekdays.contains(&d.weekday().num_days_from_monday())
                    && future
                {
                    break d;
                }
                d = d
                    .checked_add_signed(Duration::days(1))
                    .ok_or_else(error::invalid)?;
            }
        } else {
            let months = (threshold.year() - original.year()) * 12 + threshold.month() as i32
                - original.month() as i32;
            let stride = r
                .interval
                .checked_mul(if r.unit == "year" { 12 } else { 1 })
                .ok_or_else(error::invalid)?;
            let mut n = (months.max(0) as u32) / stride;
            loop {
                let d = shift_month(original, n.checked_mul(stride).ok_or_else(error::invalid)?)?;
                if d > start
                    && if let Some(t) = &current.start_time {
                        d.and_time(time(t)?) > completed
                    } else {
                        d > completed.date()
                    }
                {
                    break d;
                }
                n += 1;
            }
        }
    };
    if candidate.year() > 9999 {
        return Ok(None);
    }
    if r.until
        .as_deref()
        .map(date)
        .transpose()?
        .is_some_and(|d| candidate > d)
    {
        return Ok(None);
    }
    let mut result = current.clone();
    result.start_date = candidate.to_string();
    let span = current
        .end_date
        .as_deref()
        .map(date)
        .transpose()?
        .unwrap_or(start)
        - start;
    if current.end_date.is_some() {
        result.end_date = Some((candidate + span).to_string())
    }
    if r.mode == "relative" && current.start_time.is_some() {
        let base = candidate
            .and_hms_opt(completed.hour(), completed.minute(), 0)
            .ok_or_else(error::invalid)?;
        if let Some(et) = &current.end_time {
            let duration = (start + span).and_time(time(et)?)
                - start.and_time(time(current.start_time.as_deref().unwrap())?);
            let end = base + duration;
            result.end_time = Some(end.format("%H:%M").to_string());
            if current.end_date.is_some() || end.date() != candidate {
                result.end_date = Some(end.date().to_string())
            }
        }
        result.start_time = Some(base.format("%H:%M").to_string());
    }
    if result.end_date.as_deref().is_some_and(|d| date(d).is_err()) {
        return Ok(None);
    }
    result.validate()?;
    Ok(Some(result))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn s(start: &str, unit: &str) -> Schedule {
        serde_json::from_value(serde_json::json!({"start_date":start,"timezone":"Asia/Shanghai","repeat":{"unit":unit,"interval":1,"weekdays":if unit=="week" {vec![0,2]}else{vec![]}}})).unwrap()
    }
    fn at(s: &str) -> chrono::NaiveDateTime {
        chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M").unwrap()
    }
    #[test]
    fn calendar_month_anchor_clamps_without_drift_and_keeps_span() {
        let mut rule = s("2028-01-31", "month");
        rule.end_date = Some("2028-02-02".into());
        rule.start_time = Some("09:00".into());
        rule.end_time = Some("17:00".into());
        let feb = next(&rule, &rule, at("2028-02-01 12:00"), 1)
            .unwrap()
            .unwrap();
        assert_eq!(feb.start_date, "2028-02-29");
        assert_eq!(feb.end_date.as_deref(), Some("2028-03-02"));
        let march = next(&feb, &rule, at("2028-03-01 12:00"), 2)
            .unwrap()
            .unwrap();
        assert_eq!(march.start_date, "2028-03-31");
        assert_eq!(march.start_time.as_deref(), Some("09:00"));
    }
    #[test]
    fn calendar_skip_does_not_consume_actual_count() {
        let mut rule = s("2020-01-01", "day");
        rule.repeat.as_mut().unwrap().count = Some(2);
        let n = next(&rule, &rule, at("2028-10-17 12:00"), 1)
            .unwrap()
            .unwrap();
        assert_eq!(n.start_date, "2028-10-18");
        assert!(
            next(&n, &rule, at("2028-10-18 12:00"), 2)
                .unwrap()
                .is_none()
        );
    }
    #[test]
    fn selected_weekdays_every_two_weeks_and_until() {
        let mut rule = s("2028-01-03", "week");
        rule.repeat.as_mut().unwrap().interval = 2;
        let n = next(&rule, &rule, at("2028-01-05 12:00"), 1)
            .unwrap()
            .unwrap();
        assert_eq!(n.start_date, "2028-01-17");
        rule.repeat.as_mut().unwrap().until = Some("2028-01-10".into());
        assert!(
            next(&rule, &rule, at("2028-01-05 12:00"), 1)
                .unwrap()
                .is_none()
        );
    }
    #[test]
    fn leap_year_clamp_and_relative_interval() {
        let rule = s("2028-02-29", "year");
        assert_eq!(
            next(&rule, &rule, at("2028-03-01 12:00"), 1)
                .unwrap()
                .unwrap()
                .start_date,
            "2029-02-28"
        );
        let mut rule = s("2020-01-01", "day");
        rule.repeat.as_mut().unwrap().mode = "relative".into();
        rule.repeat.as_mut().unwrap().interval = 3;
        rule.start_time = Some("09:00".into());
        rule.end_time = Some("11:00".into());
        let n = next(&rule, &rule, at("2028-10-17 15:30"), 1)
            .unwrap()
            .unwrap();
        assert_eq!(n.start_date, "2028-10-20");
        assert_eq!(n.start_time.as_deref(), Some("15:30"));
        assert_eq!(n.end_time.as_deref(), Some("17:30"));
    }
}

#[test]
fn schedule_rejects_zero_year_and_weekly_relative_respects_selected_days() {
    let bad = Schedule::day("0000-01-01".into());
    assert!(bad.validate().is_err());
    let s:Schedule=serde_json::from_value(serde_json::json!({"start_date":"2028-01-03","repeat":{"unit":"week","mode":"relative","interval":1,"weekdays":[4]}})).unwrap();
    let completed =
        chrono::NaiveDateTime::parse_from_str("2028-01-04 12:00", "%Y-%m-%d %H:%M").unwrap();
    assert_eq!(
        next(&s, &s, completed, 1).unwrap().unwrap().start_date,
        "2028-01-14"
    );
}

#[test]
fn schedule_errors_explain_invalid_range_and_repeat() {
    let mut s = Schedule::day("2028-01-02".into());
    s.end_date = Some("2028-01-01".into());
    assert!(s.validate().unwrap_err().2.contains("结束"));
    let mut s = Schedule::day("2028-01-02".into());
    s.start_time = Some("24:00".into());
    assert!(s.validate().unwrap_err().2.contains("时间"));
}

#[test]
fn accepted_maximum_date_finishes_without_successor() {
    let rule: Schedule = serde_json::from_value(
        serde_json::json!({"start_date":"9999-12-31","repeat":{"unit":"day","count":2}}),
    )
    .unwrap();
    rule.validate().unwrap();
    let completed =
        chrono::NaiveDateTime::parse_from_str("9999-12-31 12:00", "%Y-%m-%d %H:%M").unwrap();
    assert!(next(&rule, &rule, completed, 1).unwrap().is_none());
}
