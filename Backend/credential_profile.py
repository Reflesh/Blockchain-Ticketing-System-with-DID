"""Consistent holder-bound VC 1.1 JWT profile; restoring never extends validity."""
from datetime import datetime, timezone


def credential_payload(issuer, signer, jwk, configuration, credential_id, issued_at, expires_at, account=None):
    issued_at, expires_at = int(issued_at), int(expires_at)
    if expires_at <= issued_at:
        raise ValueError('Credential validity is invalid')
    def stamp(value):
        return datetime.fromtimestamp(value, timezone.utc).isoformat().replace('+00:00', 'Z')
    subject = {'id': f'did:pknu:{signer}'}
    if configuration == 'TicketProMobileCredential':
        if not account:
            raise ValueError('Mobile credential requires its primary account')
        subject.update(account=f'did:pknu:{account}', authorization='mobile_login')
    else:
        subject.update(university='부경대학교', isStudent=True)
    return {'iss': issuer, 'sub': subject['id'], 'iat': issued_at, 'nbf': issued_at,
            'exp': expires_at, 'jti': credential_id,
            'cnf': {'jwk': {key: jwk[key] for key in ('kty', 'crv', 'x', 'y')}},
            'vc': {'@context': ['https://www.w3.org/2018/credentials/v1', {
                'TicketProMobileCredential': 'urn:ticketpro:MobileCredential',
                'PukyongStudentCredential': 'urn:ticketpro:StudentCredential',
                'TicketProCredentialStatus': 'urn:ticketpro:CredentialStatus',
                'account': {'@id': 'urn:ticketpro:account', '@type': '@id'},
                'authorization': 'urn:ticketpro:authorization',
                'university': 'urn:ticketpro:university', 'isStudent': 'urn:ticketpro:isStudent'}],
                'id': credential_id, 'type': ['VerifiableCredential', configuration],
                'issuer': issuer, 'issuanceDate': stamp(issued_at), 'expirationDate': stamp(expires_at),
                'credentialSubject': subject,
                'credentialStatus': {'id': f'{issuer}/api/status/{signer}', 'type': 'TicketProCredentialStatus'}}}
