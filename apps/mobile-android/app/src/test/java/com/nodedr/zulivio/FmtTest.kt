package com.nodedr.zulivio

import com.nodedr.zulivio.ui.components.Fmt
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FmtTest {
    @Test fun `ten digit numbers are grouped, every digit kept`() = assertEquals("98765 00001", Fmt.phone("9876500001"))
    @Test fun `international numbers keep the plus`() = assertEquals("+91 98765 00001", Fmt.phone("+919876500001"))
    @Test fun `odd numbers are left as typed`() = assertEquals("1800-123", Fmt.phone("1800-123"))
    @Test fun `duration is never invented`() { assertNull(Fmt.duration(null)); assertNull(Fmt.duration(0)); assertEquals("45s", Fmt.duration(45)); assertEquals("2m 5s", Fmt.duration(125)) }
    @Test fun `initials`() { assertEquals("AM", Fmt.initials("Aarav Mehta")); assertEquals("?", Fmt.initials("")) }
    @Test fun `enum labels`() = assertEquals("No Answer", Fmt.enumLabel("NO_ANSWER"))
}
