package com.nodedr.zulivio.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Tokens copied from the web app's DESIGN.md ("calm control room": cool-grey canvas, hairlines, one emerald accent). */
private val Light = lightColorScheme(
    primary = Color(0xFF0B7A5A), onPrimary = Color.White,
    primaryContainer = Color(0xFFE4F4EE), onPrimaryContainer = Color(0xFF06382A),
    secondary = Color(0xFF43535E), onSecondary = Color.White,
    secondaryContainer = Color(0xFFF0F2F4), onSecondaryContainer = Color(0xFF14212A),
    background = Color(0xFFF6F7F8), onBackground = Color(0xFF14212A),
    surface = Color(0xFFFFFFFF), onSurface = Color(0xFF14212A),
    surfaceVariant = Color(0xFFF0F2F4), onSurfaceVariant = Color(0xFF43535E),
    surfaceContainerLowest = Color(0xFFFFFFFF), surfaceContainerLow = Color(0xFFFFFFFF),
    surfaceContainer = Color(0xFFF0F2F4), surfaceContainerHigh = Color(0xFFE9ECEF), surfaceContainerHighest = Color(0xFFE3E7EA),
    outline = Color(0xFF6B7C87), outlineVariant = Color(0xFFE3E7EA),
    error = Color(0xFFB91C1C), onError = Color.White, errorContainer = Color(0xFFFBE7E7), onErrorContainer = Color(0xFF5F1111),
)

private val Dark = darkColorScheme(
    primary = Color(0xFF2FBF92), onPrimary = Color(0xFF06231A),
    primaryContainer = Color(0xFF12302A), onPrimaryContainer = Color(0xFFB8F0DC),
    secondary = Color(0xFFA9B8C1), onSecondary = Color(0xFF0E1418),
    secondaryContainer = Color(0xFF1B252C), onSecondaryContainer = Color(0xFFEAF0F2),
    background = Color(0xFF0E1418), onBackground = Color(0xFFEAF0F2),
    surface = Color(0xFF151D23), onSurface = Color(0xFFEAF0F2),
    surfaceVariant = Color(0xFF1B252C), onSurfaceVariant = Color(0xFFA9B8C1),
    surfaceContainerLowest = Color(0xFF0E1418), surfaceContainerLow = Color(0xFF151D23),
    surfaceContainer = Color(0xFF1B252C), surfaceContainerHigh = Color(0xFF22303A), surfaceContainerHighest = Color(0xFF26323A),
    outline = Color(0xFF7E909B), outlineVariant = Color(0xFF26323A),
    error = Color(0xFFF87171), onError = Color(0xFF3A1717), errorContainer = Color(0xFF3A1717), onErrorContainer = Color(0xFFFBD5D5),
)

/** Status colours that Material3 has no slot for. Always paired with an icon or a word, never colour alone. */
@Immutable data class Semantic(val ok: Color, val okSoft: Color, val warn: Color, val warnSoft: Color, val info: Color, val infoSoft: Color)

private val LightSemantic = Semantic(Color(0xFF15803D), Color(0xFFE3F4E9), Color(0xFFB45309), Color(0xFFFCF1DD), Color(0xFF2563EB), Color(0xFFE6EEFD))
private val DarkSemantic = Semantic(Color(0xFF4ADE80), Color(0xFF12301E), Color(0xFFF5B544), Color(0xFF38280E), Color(0xFF6EA0FF), Color(0xFF14284F))
val LocalSemantic = staticCompositionLocalOf { LightSemantic }

private val Sans = FontFamily.SansSerif
private val AppTypography = Typography(
    headlineSmall = TextStyle(fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 22.sp, lineHeight = 28.sp, letterSpacing = (-0.2).sp),
    titleLarge = TextStyle(fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 20.sp, lineHeight = 26.sp, letterSpacing = (-0.2).sp),
    titleMedium = TextStyle(fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, lineHeight = 22.sp),
    titleSmall = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Medium, fontSize = 14.sp, lineHeight = 20.sp),
    bodyLarge = TextStyle(fontFamily = Sans, fontSize = 16.sp, lineHeight = 24.sp),
    bodyMedium = TextStyle(fontFamily = Sans, fontSize = 14.sp, lineHeight = 21.sp),
    bodySmall = TextStyle(fontFamily = Sans, fontSize = 12.sp, lineHeight = 17.sp),
    labelLarge = TextStyle(fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, lineHeight = 20.sp),
    labelMedium = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Medium, fontSize = 12.sp, lineHeight = 16.sp),
    labelSmall = TextStyle(fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 11.sp, lineHeight = 14.sp, letterSpacing = 0.4.sp),
)

private val AppShapes = Shapes(
    extraSmall = androidx.compose.foundation.shape.RoundedCornerShape(6.dp),
    small = androidx.compose.foundation.shape.RoundedCornerShape(8.dp),
    medium = androidx.compose.foundation.shape.RoundedCornerShape(12.dp),
    large = androidx.compose.foundation.shape.RoundedCornerShape(16.dp),
    extraLarge = androidx.compose.foundation.shape.RoundedCornerShape(24.dp),
)

@Composable
fun ZulivioTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalSemantic provides if (dark) DarkSemantic else LightSemantic) {
        MaterialTheme(colorScheme = if (dark) Dark else Light, typography = AppTypography, shapes = AppShapes, content = content)
    }
}
