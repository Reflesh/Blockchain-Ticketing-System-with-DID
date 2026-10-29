# Experimental did:pknu method

This graduation-project method identifies a secp256k1 controller by its Ethereum
address: `did:pknu:0x<40 hex digits>`. Address comparisons ignore case; resolved
documents use the EIP-55 form. It is an experimental application method, not a
claim of registration or production interoperability.

Registration happens when the issuer records a primary student credential or a
delegated mobile credential after proof of key control. `/api/did/{address}`
resolves both kinds of registered address to an address-based verification
method. Issuer registration is configured separately. Resolution exposes no email.

Keys are immutable for an address-based DID. A new key has a new DID. Recovery
issues a new delegated mobile credential referencing the same original account;
it does not change the original NFT wallet or recover its private key. Existing
tickets stay owned by that account. Owner-only NFT transfers still need its key.

Credential revocation/expiry is checked at `/api/status/{address}` and during
sessions and QR verification. Revoking a credential does not deactivate its DID
or erase its document. DID deactivation and controller/key update operations are
not implemented. Consequently `didDocumentMetadata.deactivated` remains false;
it is not a statement that a student's credential is active.

JWT credentials use the VC 1.1 context, issuer, subject, type, validity, status and
holder public key. Mobile credentials additionally bind the original account.
Status is an application-specific status mechanism. HTTPS migration remains out
of scope; this deployment makes no claim of full OID4VCI transport conformance.
