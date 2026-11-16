import unittest
from unittest.mock import MagicMock
from account_sync import sync_verified_user, ProfileRestrictedError

class AccountSyncTests(unittest.TestCase):
    address = '0x' + '12' * 20
    def test_invalid_address(self):
        c=MagicMock()
        with self.assertRaises(ValueError):sync_verified_user(c,'invalid','x@example.test')
        c.execute.assert_not_called()
    def test_new_verified_user(self):
        c=MagicMock();c.fetchone.side_effect=[None,None,{'username':'student'}]
        self.assertEqual(sync_verified_user(c,self.address,'student@example.test')['username'],'student')
        self.assertEqual(c.execute.call_args.args[1],('student',self.address))
    def test_existing_nickname_and_address_preserved(self):
        c=MagicMock();c.fetchone.side_effect=[{'username':'chosen','wallet_address':self.address,'status':'active'},{'username':'chosen'}]
        sync_verified_user(c,self.address,'other@example.test')
        self.assertEqual(c.execute.call_args.args[1],('chosen',self.address))
    def test_restricted_user_cannot_be_reactivated(self):
        c=MagicMock();c.fetchone.return_value={'username':'blocked','wallet_address':self.address,'status':'restricted'}
        with self.assertRaises(ProfileRestrictedError):sync_verified_user(c,self.address,'x@example.test')
        self.assertFalse(any('INSERT' in x.args[0] or 'UPDATE SET' in x.args[0] for x in c.execute.call_args_list))
    def test_collision_uses_suffix_not_full_email(self):
        c=MagicMock();c.fetchone.side_effect=[None,{'id':1},None,{'username':'student_1'}]
        sync_verified_user(c,self.address,'student@example.test')
        self.assertEqual(c.execute.call_args.args[1][0],'student_1')
    def test_missing_email_uses_wallet_nickname(self):
        c=MagicMock();c.fetchone.side_effect=[None,None,{'username':'ticketpro_12121212'}]
        sync_verified_user(c,self.address,None)
        self.assertEqual(c.execute.call_args.args[1][0],'ticketpro_12121212')

if __name__=='__main__':unittest.main()
