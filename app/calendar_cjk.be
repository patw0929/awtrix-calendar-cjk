# @name    Google Calendar CJK
# @desc    Upcoming Google Calendar events with CJK dynamic bitmap & multi-language agenda
# @author  patw (based on Mvrcl1005)
# @version 2.0
# @display 52x16
# @config  ical  text   "iCal URL"          help="Google Calendar Secret iCal URL (Private address in iCal format)"
# @config  proxy text   "Worker URL"        default="https://your-worker-name.your-subdomain.workers.dev" help="Cloudflare Worker CJK Proxy URL"
# @config  lang  select "Language"          default="zh-TW" options="en,zh-TW,zh-CN,ja,ko" help="Language for weekdays and relative dates"
# @config  tz    text   "Time zone"         default="Asia/Taipei" help="IANA time zone, e.g. Asia/Taipei, Europe/London"
# @config  days  number "Max future days"   default=14 min=1 max=90 help="Show events within this many days"
# @config  cycle number "Auto cycle (sec)"   default=8 min=0 max=60 unit=sec help="0 = manual knob control only (no auto cycle), >0 = auto switch seconds"
# @config  every number "Refresh interval"  default=15 min=1 max=60 unit=min help="Calendar sync interval"
# @config  speed slider "Scroll speed"      default=100 min=25 max=300 step=5 unit=% help="100 % = normal speed"
# @config  tcol  color  "Time / day colour" default=#8AB4F8 help="Colour for date, time, and weekday"
# @config  hide  bool   "Hide when empty"   default=true help="Hide app when no upcoming events"

import json
import string

class GoogleCalendarCJK
  var worker_url, ical_url, lang, tz, days, period, ticks, busy, retry_sec
  var cycle_sec, cycle_timer, cur_idx, rows, status_msg
  var tcol, tc, speed, hide
  var title_scroll_x, title_scroll_delay
  var time_scroll_x, time_scroll_delay
  var dayn, day1, day2, font

  def init()
    self.worker_url = store.get("proxy")
    if self.worker_url == nil || size(self.worker_url) == 0
      self.worker_url = store.get("worker")
    end
    if self.worker_url == nil || size(self.worker_url) == 0
      self.worker_url = "https://your-worker-name.your-subdomain.workers.dev"
    end

    self.ical_url = store.get("ical")
    if self.ical_url == nil
      self.ical_url = ""
    end

    self.lang = store.get("lang")
    if self.lang == nil self.lang = "zh-TW" end

    self.tz = store.get("tz")
    if self.tz == nil self.tz = "Asia/Taipei" end

    var d = store.get("days")
    self.days = d != nil ? int(d) : 14

    var p = store.get("every")
    self.period = p != nil ? int(p) * 60 : 900

    var cyc = store.get("cycle")
    self.cycle_sec = cyc != nil ? int(cyc) : 8
    self.cycle_timer = self.cycle_sec

    var sp = store.get("speed")
    self.speed = sp != nil ? int(sp) : 100

    self.tcol = store.get("tcol")
    if self.tcol == nil self.tcol = 0x8AB4F8 end

    self.tc = settings.get("textColor")
    if self.tc == nil self.tc = 0xFFFFFF end

    var h = store.get("hide")
    self.hide = h != nil ? h : true

    self.ticks = 0
    self.busy = false
    self.rows = nil
    self.cur_idx = 0
    self.status_msg = "Loading..."
    self.retry_sec = nil

    self.title_scroll_x = 0
    self.title_scroll_delay = 30
    self.time_scroll_x = 0
    self.time_scroll_delay = 30

    # 3x5 digits (0-9) for calendar icon date
    self.font = [0x7B6F, 0x2C97, 0x73E7, 0x72CF, 0x5BC9, 0x79CF, 0x79EF, 0x7249, 0x7BEF, 0x7BCF]
    self.dayn = -1
    self.day1 = -1
    self.day2 = -1
  end

  def on_body(body, status)
    self.busy = false
    if body == nil || status != 200
      self.retry_sec = 5
      self.ticks = 5          # Auto-retry in 5 seconds on connection hiccup
      self.status_msg = "Retry 5s"
      return
    end
    self.retry_sec = nil

    var d = json.load(body)
    if !isinstance(d, map)
      self.status_msg = "Data Err"
      return
    end

    if d.find("error") != nil
      self.status_msg = "Worker Err"
      return
    end

    var evs = d.find("events", [])
    self.rows = evs
    if size(evs) == 0
      self.status_msg = "No events"
    else
      if self.cur_idx >= size(evs)
        self.cur_idx = 0
      end
    end
  end

  def loop()
    # Update date icon when day changes
    var dd = day()
    if dd > 0 && dd != self.dayn
      self.dayn = dd
      self.day1 = dd >= 10 ? self.font[dd / 10] : -1
      self.day2 = self.font[dd % 10]
    end

    # Automatic event cycling (1 cycle tick per second)
    var n = self.rows == nil ? 0 : size(self.rows)
    if self.cycle_sec > 0 && n > 1
      self.cycle_timer -= 1
      if self.cycle_timer <= 0
        self.cycle_timer = self.cycle_sec
        self.cur_idx = (self.cur_idx + 1) % n
        self.title_scroll_x = 0
        self.title_scroll_delay = 30
        self.time_scroll_x = 0
        self.time_scroll_delay = 30
      end
    end

    # Scheduled refresh timer
    if self.retry_sec != nil && self.retry_sec > 0
      self.retry_sec -= 1
      if self.retry_sec > 0
        self.status_msg = "Retry " + str(self.retry_sec) + "s"
      else
        self.status_msg = "Loading..."
        self.retry_sec = nil
      end
    end

    self.ticks -= 1
    if self.ticks > 0 || self.busy return end
    self.ticks = self.period

    var has_worker = size(self.worker_url) > 0 && string.find(self.worker_url, "your-worker") < 0
    if has_worker && size(self.ical_url) > 0
      self.busy = true
      if self.rows == nil || size(self.rows) == 0
        self.status_msg = "Loading..."
      end
      var full_url = self.worker_url + "?days=" + str(self.days) + "&tz=" + str(self.tz) + "&lang=" + str(self.lang) + "&ical=" + self.ical_url
      http.get(full_url, /body, status -> self.on_body(body, status))
    elif !has_worker
      self.status_msg = "Set Worker"
    else
      self.status_msg = "Set iCal"
    end
  end

  def should_show()
    return !(self.hide && self.rows != nil && size(self.rows) == 0)
  end

  # Rotary knob: turn to navigate events, press to reset to first event
  def on_knob(ev)
    var n = self.rows == nil ? 0 : size(self.rows)
    if n <= 1 return false end
    if ev == "right"
      self.cur_idx = (self.cur_idx + 1) % n
      self.title_scroll_x = 0
      self.title_scroll_delay = 30
      self.time_scroll_x = 0
      self.time_scroll_delay = 30
      self.cycle_timer = self.cycle_sec
      return true
    elif ev == "left"
      self.cur_idx = (self.cur_idx - 1 + n) % n
      self.title_scroll_x = 0
      self.title_scroll_delay = 30
      self.time_scroll_x = 0
      self.time_scroll_delay = 30
      self.cycle_timer = self.cycle_sec
      return true
    elif ev == "press"
      self.cur_idx = 0
      self.title_scroll_x = 0
      self.title_scroll_delay = 30
      self.time_scroll_x = 0
      self.time_scroll_delay = 30
      self.cycle_timer = self.cycle_sec
      return true
    end
  end

  def on_button(btn)
    if btn == "select"
      self.retry_sec = nil
      self.ticks = 0          # Force immediate refresh
      return true
    end
  end

  def on_hide()
    self.cur_idx = 0
  end

  def draw()
    clear()

    # 1. Left calendar icon (12x12, vertically centred y=2..13)
    rect_fill(2, 4, 8, 8, 0xB4B4B4)      # Base page
    rect_fill(0, 2, 10, 2, 0x4285F4)     # Top blue
    rect_fill(0, 4, 2, 8, 0x4285F4)      # Left blue
    rect_fill(0, 2, 2, 2, 0x1967D2)      # Top-left corner
    rect_fill(10, 2, 2, 10, 0xFBBC04)    # Right yellow
    rect_fill(2, 12, 8, 2, 0x34A853)     # Bottom green
    rect_fill(0, 12, 2, 2, 0x188038)     # Bottom-left corner
    rect_fill(10, 12, 2, 2, 0xEA4335)    # Red dog-ear fold
    pixel(11, 13, 0x000000)

    # Date digits inside the calendar icon
    if self.day2 >= 0
      var i = 0
      while i < 15
        var bit = 1 << (14 - i)
        if self.day1 >= 0
          if (self.day1 & bit) != 0 pixel(3 + i % 3, 6 + i / 3, 0x1A73E8) end
          if (self.day2 & bit) != 0 pixel(7 + i % 3, 6 + i / 3, 0x1A73E8) end
        elif (self.day2 & bit) != 0
          pixel(5 + i % 3, 6 + i / 3, 0x1A73E8)
        end
        i += 1
      end
    end

    var n = self.rows == nil ? 0 : size(self.rows)
    if n == 0
      # Vertically centred status text (Loading... / Err:0 / Set iCal)
      text(16, 10, self.status_msg, 0x888888)
      return
    end

    var ev = self.rows[self.cur_idx]
    var max_w = 35

    # 2. Top row (y: 0..7): Date and time with smooth scroll protection
    var time_cols = ev.find("time_cols", [])
    var total_time_w = size(time_cols)
    var time_offset = 0

    if total_time_w > max_w
      if self.time_scroll_delay > 0
        self.time_scroll_delay -= 1
      else
        time_offset = self.time_scroll_x / 4
        self.time_scroll_x += 1
        if self.time_scroll_x > (total_time_w - max_w + 10) * 4
          self.time_scroll_x = 0
          self.time_scroll_delay = 40
        end
      end
    end

    for i : 0..(max_w - 1)
      var col_idx = i + time_offset
      if col_idx >= 0 && col_idx < total_time_w
        var byte = time_cols[col_idx]
        for bit : 0..7
          if (byte & (1 << bit)) != 0
            pixel(16 + i, bit, self.tcol)
          end
        end
      end
    end

    # 3. Bottom row (y: 8..15): Full CJK event title in 35px viewport
    var title_cols = ev.find("title_cols", [])
    var total_title_w = size(title_cols)
    var title_offset = 0

    if total_title_w > max_w
      if self.title_scroll_delay > 0
        self.title_scroll_delay -= 1
      else
        title_offset = self.title_scroll_x / 4
        self.title_scroll_x += 1
        if self.title_scroll_x > (total_title_w - max_w + 10) * 4
          self.title_scroll_x = 0
          self.title_scroll_delay = 40
        end
      end
    end

    for i : 0..(max_w - 1)
      var col_idx = i + title_offset
      if col_idx >= 0 && col_idx < total_title_w
        var byte = title_cols[col_idx]
        for bit : 0..7
          if (byte & (1 << bit)) != 0
            pixel(16 + i, 8 + bit, self.tc)
          end
        end
      end
    end

    # 4. Right scroll bar indicating current event position
    if n > 1
      rect_fill(51, 0, 1, 16, 0x202020)
      var h = max(2, 16 / n)
      var y_pos = self.cur_idx * (16 - h) / (n - 1)
      rect_fill(51, y_pos, 1, h, self.tcol)
    end
  end
end

return GoogleCalendarCJK()
