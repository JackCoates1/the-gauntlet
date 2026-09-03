<?xml version="1.0" encoding="utf-8"?>
<!--
  /feed.xsl — human-friendly HTML view of the Atom feed.
  Real feed readers ignore the <?xml-stylesheet?> PI entirely and consume the
  feed as normal Atom; browsers opening /feed.xml directly render this instead
  of raw XML. Deliberately lightweight: it does not need to match the full
  site design, it just needs to not look broken. All dynamic values are pulled
  via xsl:value-of (no script, no eval).
-->
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:atom="http://www.w3.org/2005/Atom">
  <xsl:output method="html" version="1.0" encoding="utf-8" indent="yes"/>
  <xsl:template match="/atom:feed">
    <html lang="en">
      <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width,initial-scale=1"/>
        <meta name="robots" content="noindex"/>
        <title><xsl:value-of select="atom:title"/> — feed preview</title>
        <style>
          :root{color-scheme:dark}
          *{box-sizing:border-box}
          body{margin:0;background:#070a10;color:#e9edf5;font-family:Manrope,Arial,sans-serif;line-height:1.6}
          main{max-width:720px;margin:0 auto;padding:32px 20px 60px}
          .eyebrow{font:11px 'DM Mono',monospace;letter-spacing:.13em;color:#c5ff5f;margin-bottom:10px;text-transform:uppercase}
          h1{font-size:34px;letter-spacing:-.04em;margin:0 0 6px}
          .sub{color:#8490a2;font-size:14px;margin:0 0 28px}
          .updated{color:#8490a2;font:11px 'DM Mono',monospace;letter-spacing:.06em;margin-bottom:18px}
          ol{list-style:none;margin:0;padding:0}
          li{border-top:1px solid #202938;padding:18px 0}
          li a{color:#c5ff5f;text-decoration:none;font-weight:700;font-size:16px}
          li a:hover{text-decoration:underline}
          .meta{color:#8490a2;font:11px 'DM Mono',monospace;letter-spacing:.05em;margin:6px 0}
          .summary{color:#aab4c3;font-size:14px;margin:6px 0 0}
          .note{margin-top:36px;border-top:1px solid #202938;padding-top:16px;color:#7a8798;font:11px 'DM Mono',monospace;letter-spacing:.05em}
          .note a{color:#c5ff5f}
        </style>
      </head>
      <body>
        <main>
          <div class="eyebrow">RSS / ATOM FEED PREVIEW</div>
          <h1><xsl:value-of select="atom:title"/></h1>
          <p class="sub"><xsl:value-of select="atom:subtitle"/></p>
          <p class="updated">UPDATED <xsl:value-of select="atom:updated"/></p>
          <ol>
            <xsl:for-each select="atom:entry">
              <li>
                <a><xsl:attribute name="href"><xsl:value-of select="atom:link/@href"/></xsl:attribute><xsl:value-of select="atom:title"/></a>
                <div class="meta"><xsl:value-of select="atom:published"/> — <xsl:value-of select="atom:author/atom:name"/></div>
                <p class="summary"><xsl:value-of select="atom:summary"/></p>
              </li>
            </xsl:for-each>
          </ol>
          <div class="note">This is a browser preview of the Atom feed. Subscribe with any feed reader at <a href="/feed.xml">/feed.xml</a>.</div>
        </main>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
