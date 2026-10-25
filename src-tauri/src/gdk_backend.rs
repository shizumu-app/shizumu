//! Whether the deb and rpm launcher's `GDK_BACKEND=x11` is lifted.
//!
//! The installed desktop entry launches `env GDK_BACKEND=x11 shizumu` (commit
//! 1b9d3163): webkit2gtk-4.1 on a Plasma 6 Wayland desktop dropped keystrokes,
//! and XWayland did not. The flatpak strips the wrapper and runs on Wayland.
//!
//! On a Linux phone, XWayland costs two things the phone cannot do without.
//! The on-screen keyboard (squeekboard on Phosh, Maliit on Plasma Mobile)
//! serves Wayland text-input clients and does not rise for an X11 window, so
//! a text field cannot be typed into. And WebKitGTK reads `(pointer: coarse)`
//! from the GDK seat, which under X11 always carries the core pointer, so a
//! touch-only phone reads as `fine` and the phone layout never boots (see
//! src/lib/linux-phone-window.js).
//!
//! So on a phone session that is running Wayland, a `GDK_BACKEND` of exactly
//! `x11` is taken to be the launcher's and removed before GTK starts. A
//! desktop session keeps it, which is the desktop exactly as it is. Any other
//! value is the user's own choice and is left alone; so is `x11` when there
//! is no Wayland display to go back to.
//!
//! A phone session is recognised by what the session itself says:
//! `XDG_CURRENT_DESKTOP` naming Phosh (it sets `Phosh:GNOME`), or Plasma
//! Mobile's `PLASMA_PLATFORM`, which starts with `phone`. Nothing here has
//! been run on a phone: neither shell was at hand, and both values come from
//! the shells' session files, not from a device.

/// The session facts the decision reads, so it can be tested without
/// touching the process environment.
pub struct Session<'a> {
    pub gdk_backend: Option<&'a str>,
    pub current_desktop: Option<&'a str>,
    pub plasma_platform: Option<&'a str>,
    pub wayland_display: Option<&'a str>,
}

/// Is this a phone shell's session.
pub fn is_phone_session(s: &Session) -> bool {
    let phosh = s
        .current_desktop
        .map(|d| d.split(':').any(|part| part.eq_ignore_ascii_case("phosh")))
        .unwrap_or(false);
    let plasma_mobile = s
        .plasma_platform
        .map(|p| p.starts_with("phone"))
        .unwrap_or(false);
    phosh || plasma_mobile
}

/// Should the launcher's `GDK_BACKEND=x11` be removed.
pub fn should_lift_forced_x11(s: &Session) -> bool {
    s.gdk_backend == Some("x11")
        && s.wayland_display.map(|w| !w.is_empty()).unwrap_or(false)
        && is_phone_session(s)
}

/// Reads the environment and lifts `GDK_BACKEND=x11` on a phone session.
/// Called first thing in main, before any thread exists and before GTK
/// reads the variable.
#[cfg(target_os = "linux")]
pub fn lift_forced_x11_on_phone() {
    let gdk = std::env::var("GDK_BACKEND").ok();
    let desktop = std::env::var("XDG_CURRENT_DESKTOP").ok();
    let plasma = std::env::var("PLASMA_PLATFORM").ok();
    let wayland = std::env::var("WAYLAND_DISPLAY").ok();
    let session = Session {
        gdk_backend: gdk.as_deref(),
        current_desktop: desktop.as_deref(),
        plasma_platform: plasma.as_deref(),
        wayland_display: wayland.as_deref(),
    };
    if should_lift_forced_x11(&session) {
        std::env::remove_var("GDK_BACKEND");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session<'a>(
        gdk: Option<&'a str>,
        desktop: Option<&'a str>,
        plasma: Option<&'a str>,
        wayland: Option<&'a str>,
    ) -> Session<'a> {
        Session {
            gdk_backend: gdk,
            current_desktop: desktop,
            plasma_platform: plasma,
            wayland_display: wayland,
        }
    }

    #[test]
    fn phosh_on_wayland_lifts_the_launchers_x11() {
        assert!(should_lift_forced_x11(&session(
            Some("x11"),
            Some("Phosh:GNOME"),
            None,
            Some("wayland-0"),
        )));
    }

    #[test]
    fn plasma_mobile_on_wayland_lifts_the_launchers_x11() {
        assert!(should_lift_forced_x11(&session(
            Some("x11"),
            Some("KDE"),
            Some("phone:handset"),
            Some("wayland-0"),
        )));
    }

    #[test]
    fn a_plasma_desktop_keeps_x11() {
        // The session the launcher's x11 exists for: Plasma 6 on Wayland,
        // where webkit2gtk-4.1 dropped keystrokes. It must keep XWayland.
        assert!(!should_lift_forced_x11(&session(
            Some("x11"),
            Some("KDE"),
            None,
            Some("wayland-0"),
        )));
    }

    #[test]
    fn a_gnome_desktop_keeps_x11() {
        assert!(!should_lift_forced_x11(&session(
            Some("x11"),
            Some("GNOME"),
            None,
            Some("wayland-0"),
        )));
    }

    #[test]
    fn a_phone_with_no_wayland_display_keeps_x11() {
        // nothing to go back to: removing the variable would leave GTK to
        // pick X11 anyway, or nothing
        assert!(!should_lift_forced_x11(&session(
            Some("x11"),
            Some("Phosh:GNOME"),
            None,
            None,
        )));
        assert!(!should_lift_forced_x11(&session(
            Some("x11"),
            Some("Phosh:GNOME"),
            None,
            Some(""),
        )));
    }

    #[test]
    fn any_other_backend_value_is_the_users_and_stays() {
        // not the launcher's exact "x11": "wayland", "x11,wayland" or unset
        // are left as they are, so there is nothing to lift
        for v in [None, Some("wayland"), Some("x11,wayland"), Some("broadway")] {
            assert!(!should_lift_forced_x11(&session(
                v,
                Some("Phosh:GNOME"),
                None,
                Some("wayland-0"),
            )));
        }
    }

    #[test]
    fn phosh_is_matched_as_a_whole_desktop_name() {
        assert!(is_phone_session(&session(None, Some("phosh"), None, None)));
        assert!(!is_phone_session(&session(None, Some("Phoshless"), None, None)));
        assert!(!is_phone_session(&session(None, Some("KDE"), Some("desktop"), None)));
    }
}
