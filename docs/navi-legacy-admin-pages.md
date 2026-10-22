# Legacy administration pages

The legacy `/admin/users` and `/admin/organizations` pages display a shared Japanese/Korean notice with a link to `/settings/organization`. They make no global administration API requests and retain their existing `admin` middleware. Company information, membership and invitations remain on the native company settings page under its existing permissions.

The five legacy global APIs continue to refuse authenticated requests with `GLOBAL_ADMIN_UNAVAILABLE`; anonymous requests require sign-in. A company administrator is not a platform administrator. This presentation change adds no authorization rule and does not grant platform access.

Implementation: `components/admin/LegacyAdministrationUnavailable.vue`; authorization evidence: `scripts/zoomer-fixtures/omf-platform-admin.mjs`. The release's case-owned visual captures cover both routes at mobile and desktop widths, including the actual company-settings link. No production records or real credentials are needed for those captures.
