# RouterOS v7 Expiration Schedulers

These scripts monitor hotspot users and remove them once their validity timestamp in `comment` (formatted as `YYYY-MM-DD HH:MM:SS`) is reached or passed. Compatible with RouterOS v7.

---

## 1. DailySub

### Terminal Command (Quick Copy & Paste)
```routeros
/system scheduler set [find name="DailySub"] on-event=":local date [ /system clock get date ]; :local time [ /system clock get time ]; :local today [:tonum ([:pick \$date 0 4] . [:pick \$date 5 7] . [:pick \$date 8 10])]; :local curtime (([:tonum [:pick \$time 0 2]] * 3600) + ([:tonum [:pick \$time 3 5]] * 60) + [:tonum [:pick \$time 6 8]]); :foreach i in=[ /ip hotspot user find where profile=\"DailySub\" ] do={ :local comment [ /ip hotspot user get \$i comment ]; :local name [ /ip hotspot user get \$i name ]; :if ([:len \$comment] >= 19 and [:pick \$comment 4] = \"-\" and [:pick \$comment 7] = \"-\") do={ :local expd [:tonum ([:pick \$comment 0 4] . [:pick \$comment 5 7] . [:pick \$comment 8 10])]; :local expt (([:tonum [:pick \$comment 11 13]] * 3600) + ([:tonum [:pick \$comment 14 16]] * 60) + [:tonum [:pick \$comment 17 19]]); :if ((\$expd < \$today) or (\$expd = \$today and \$expt <= \$curtime)) do={ /ip hotspot user remove \$i; /ip hotspot active remove [find where user=\$name]; :log info \"Hotspot: Expired user \$name removed\"; }}}"
```

### WinBox GUI Version
*(System > Scheduler > open "DailySub" > paste in On Event box)*
```routeros
:local date [ /system clock get date ];
:local time [ /system clock get time ];
:local today [:tonum ([:pick $date 0 4] . [:pick $date 5 7] . [:pick $date 8 10])];
:local curtime (([:tonum [:pick $time 0 2]] * 3600) + ([:tonum [:pick $time 3 5]] * 60) + [:tonum [:pick $time 6 8]]);

:foreach i in=[ /ip hotspot user find where profile="DailySub" ] do={
  :local comment [ /ip hotspot user get $i comment ];
  :local name [ /ip hotspot user get $i name ];
  :if ([:len $comment] >= 19 and [:pick $comment 4] = "-" and [:pick $comment 7] = "-") do={
    :local expd [:tonum ([:pick $comment 0 4] . [:pick $comment 5 7] . [:pick $comment 8 10])];
    :local expt (([:tonum [:pick $comment 11 13]] * 3600) + ([:tonum [:pick $comment 14 16]] * 60) + [:tonum [:pick $comment 17 19]]);
    :if (($expd < $today) or ($expd = $today and $expt <= $curtime)) do={
      /ip hotspot user remove $i;
      /ip hotspot active remove [find where user=$name];
      :log info "Hotspot: Expired user $name removed";
    }
  }
}
```

---

## 2. WeeklySub

### Terminal Command (Quick Copy & Paste)
```routeros
/system scheduler set [find name="WeeklySub"] on-event=":local date [ /system clock get date ]; :local time [ /system clock get time ]; :local today [:tonum ([:pick \$date 0 4] . [:pick \$date 5 7] . [:pick \$date 8 10])]; :local curtime (([:tonum [:pick \$time 0 2]] * 3600) + ([:tonum [:pick \$time 3 5]] * 60) + [:tonum [:pick \$time 6 8]]); :foreach i in=[ /ip hotspot user find where profile=\"WeeklySub\" ] do={ :local comment [ /ip hotspot user get \$i comment ]; :local name [ /ip hotspot user get \$i name ]; :if ([:len \$comment] >= 19 and [:pick \$comment 4] = \"-\" and [:pick \$comment 7] = \"-\") do={ :local expd [:tonum ([:pick \$comment 0 4] . [:pick \$comment 5 7] . [:pick \$comment 8 10])]; :local expt (([:tonum [:pick \$comment 11 13]] * 3600) + ([:tonum [:pick \$comment 14 16]] * 60) + [:tonum [:pick \$comment 17 19]]); :if ((\$expd < \$today) or (\$expd = \$today and \$expt <= \$curtime)) do={ /ip hotspot user remove \$i; /ip hotspot active remove [find where user=\$name]; :log info \"Hotspot: Expired user \$name removed\"; }}}"
```

### WinBox GUI Version
*(System > Scheduler > open "WeeklySub" > paste in On Event box)*
```routeros
:local date [ /system clock get date ];
:local time [ /system clock get time ];
:local today [:tonum ([:pick $date 0 4] . [:pick $date 5 7] . [:pick $date 8 10])];
:local curtime (([:tonum [:pick $time 0 2]] * 3600) + ([:tonum [:pick $time 3 5]] * 60) + [:tonum [:pick $time 6 8]]);

:foreach i in=[ /ip hotspot user find where profile="WeeklySub" ] do={
  :local comment [ /ip hotspot user get $i comment ];
  :local name [ /ip hotspot user get $i name ];
  :if ([:len $comment] >= 19 and [:pick $comment 4] = "-" and [:pick $comment 7] = "-") do={
    :local expd [:tonum ([:pick $comment 0 4] . [:pick $comment 5 7] . [:pick $comment 8 10])];
    :local expt (([:tonum [:pick $comment 11 13]] * 3600) + ([:tonum [:pick $comment 14 16]] * 60) + [:tonum [:pick $comment 17 19]]);
    :if (($expd < $today) or ($expd = $today and $expt <= $curtime)) do={
      /ip hotspot user remove $i;
      /ip hotspot active remove [find where user=$name];
      :log info "Hotspot: Expired user $name removed";
    }
  }
}
```

---

## 3. MonthlySub

### Terminal Command (Quick Copy & Paste)
```routeros
/system scheduler set [find name="MonthlySub"] on-event=":local date [ /system clock get date ]; :local time [ /system clock get time ]; :local today [:tonum ([:pick \$date 0 4] . [:pick \$date 5 7] . [:pick \$date 8 10])]; :local curtime (([:tonum [:pick \$time 0 2]] * 3600) + ([:tonum [:pick \$time 3 5]] * 60) + [:tonum [:pick \$time 6 8]]); :foreach i in=[ /ip hotspot user find where profile=\"MonthlySub\" ] do={ :local comment [ /ip hotspot user get \$i comment ]; :local name [ /ip hotspot user get \$i name ]; :if ([:len \$comment] >= 19 and [:pick \$comment 4] = \"-\" and [:pick \$comment 7] = \"-\") do={ :local expd [:tonum ([:pick \$comment 0 4] . [:pick \$comment 5 7] . [:pick \$comment 8 10])]; :local expt (([:tonum [:pick \$comment 11 13]] * 3600) + ([:tonum [:pick \$comment 14 16]] * 60) + [:tonum [:pick \$comment 17 19]]); :if ((\$expd < \$today) or (\$expd = \$today and \$expt <= \$curtime)) do={ /ip hotspot user remove \$i; /ip hotspot active remove [find where user=\$name]; :log info \"Hotspot: Expired user \$name removed\"; }}}"
```

### WinBox GUI Version
*(System > Scheduler > open "MonthlySub" > paste in On Event box)*
```routeros
:local date [ /system clock get date ];
:local time [ /system clock get time ];
:local today [:tonum ([:pick $date 0 4] . [:pick $date 5 7] . [:pick $date 8 10])];
:local curtime (([:tonum [:pick $time 0 2]] * 3600) + ([:tonum [:pick $time 3 5]] * 60) + [:tonum [:pick $time 6 8]]);

:foreach i in=[ /ip hotspot user find where profile="MonthlySub" ] do={
  :local comment [ /ip hotspot user get $i comment ];
  :local name [ /ip hotspot user get $i name ];
  :if ([:len $comment] >= 19 and [:pick $comment 4] = "-" and [:pick $comment 7] = "-") do={
    :local expd [:tonum ([:pick $comment 0 4] . [:pick $comment 5 7] . [:pick $comment 8 10])];
    :local expt (([:tonum [:pick $comment 11 13]] * 3600) + ([:tonum [:pick $comment 14 16]] * 60) + [:tonum [:pick $comment 17 19]]);
    :if (($expd < $today) or ($expd = $today and $expt <= $curtime)) do={
      /ip hotspot user remove $i;
      /ip hotspot active remove [find where user=$name];
      :log info "Hotspot: Expired user $name removed";
    }
  }
}
```